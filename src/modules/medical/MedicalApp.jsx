import { default as React, useState, useRef, useEffect, useMemo, useCallback, startTransition } from 'react';
import { Chart, ExcelJS, localforage, CryptoJS } from '../../core/vendor.js';
import { MedicalPersonnelDirectory } from '../../core/personnel-directory.js';
import { MedicalSeriesChart } from './MedicalSeriesChart.jsx';
import { useSharedDictionaries } from '../../core/use-shared-dictionaries.js';
import { parseMedicalDate, medicalWaitTime, pickMedicalEpisode, chronologyIssues, localMedicalInput, describeInjuries, injuryGroups, INJURY_LABELS, INJURY_GROUPS } from '../../core/medical-records.js';
import { personCandidates } from '../../core/person-names.js';
import { ChronologyDialog, PersonMatchDialog, StatusHistoryChainBadge } from './RecordReview.jsx';
import { createMedicalWorkbook } from './medical-workbook.js';

const MedicalApp = (function() {
        const LEGACY_MED_STORAGE_KEYS = [
            'med_soldiers_v2', 'med_soldiers_v3',
            'med_episodes_v2', 'med_episodes_v3',
            'med_logs_v2', 'med_logs_v3',
        ];
        const clearLegacyMedLocalStorage = ({ includeLogs = true } = {}) => {
            try {
                LEGACY_MED_STORAGE_KEYS
                    .filter(key => includeLogs || !key.startsWith('med_logs_'))
                    .forEach(key => localStorage.removeItem(key));
            } catch (_) {}
        };
            

        const DEFAULT_RANKS = ["Солдат", "Старший солдат", "Молодший сержант", "Сержант", "Старший сержант", "Головний сержант", "Молодший лейтенант", "Лейтенант", "Старший лейтенант", "Капітан", "Майор"];
        const DEFAULT_UNITS = [
            "1-ша рота", "2-га рота", "3-тя рота", "4 МР", "5 МР", "6 МР",
            "Бронегрупа", "Взвод НРК", "Взвод охорони", "ІСВ", "Взвод ПТРК",
            "ВМЗ", "ВРБ", "ВТЗ", "Гран взвод", "Зв’язок", "ЗР взвод",
            "Кул взвод", "МінБат", "МП", "РБпАК", "РВ", "Управління",
            "Взвод вогневої підтримки", "Розвідвзвод", "Управління батальйону"
        ];
        const DEFAULT_SECTORS = ["Позиція 'Альфа'", "Позиція 'Браво'", "КСП батальйону", "Точка вивантаження", "Стабпункт"];
        const DEFAULT_CAUSES = [
            "Удар КАБом", "Удар FPV", "Удар FPV (оптоволокно)", "Удар FPV (крило)", "Скид з БПЛА", 
            "Скид горючої суміші з дрона", "Скид з важкого бомбера", "Обстріл з міномета, 82мм", 
            "Обстріл з міномета, 120мм", "Обстріл з ствольної артилерії", "Підрив на ворожому мінуванні", 
            "Стрілецька зброя", "Залишив позицію", "Нещасний випадок / Хвороба", "Інше"
        ];

        const DEFAULT_AWOL_CAUSES = [
            "З бойової позиції", 
            "З району розташування (ППД/тилу)", 
            "З лікування / шпиталю / ВЛК", 
            "З відпустки / відрядження", 
            "Під час ротації / переміщення", 
            "Не прибув з НЦ/ТЦК", 
            "Інше"
        ];

        const LOSS_TYPES = [
            "Поранення (300)", "Небойове травмування (300)", 
            "Загибель (200)", "Небойова смерть (200)", "200 (від ран)", "Зниклий безвісти (ЗБВ)", "СЗЧ", "Повернення з СЗЧ", "Дезертирство"
        ];
        
        const isAny300 = (type) => type && type.includes("(300)");
        const isAwol = (type) => type === "СЗЧ" || type === "Повернення з СЗЧ" || type === "Дезертирство";
        const isAwolReturnEp = (ep) => Boolean(ep && (ep.lossType === "Повернення з СЗЧ" || (isAwol(ep.lossType) && ep.awolStatus === "Повернувся")));
        const isAny200 = (type) => type && (type.includes("(200)") || type.includes("200 (від ран)"));
        const isLossTypeActive = (lossType, dynFilters, groupAnalytics) => {
            if (!dynFilters) return true;
            let effType = lossType;
            if (groupAnalytics) {
                if (effType === 'Зниклий безвісти (ЗБВ)') effType = 'Загибель (200)';
                if (effType === 'Бойове травмування (300)') effType = 'Поранення (300)';
            }
            if (effType === 'Загибель (200)') return !!dynFilters.show200;
            if (effType === '200 (від ран)') return !!dynFilters.show200pvr;
            if (effType === 'Небойова смерть (200)') return !!dynFilters.showNonCombatDead;
            if (effType === 'Поранення (300)') return !!dynFilters.showWound;
            if (effType === 'Бойове травмування (300)') return !!dynFilters.showCombatTr;
            if (effType === 'Небойове травмування (300)') return !!dynFilters.showNonCombatTr;
            if (effType === 'Зниклий безвісти (ЗБВ)') return !!dynFilters.showMIA;
            if (effType === 'СЗЧ' || effType === 'Повернення з СЗЧ' || effType === 'Дезертирство') return !!dynFilters.showAWOL;
            if (isAny200(effType)) return !!dynFilters.show200;
            if (isAny300(effType)) return !!dynFilters.showWound;
            return true;
        };

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
                    color: '#b8bec8', font: { family: "'Segoe UI Variable Text', Inter, system-ui, sans-serif", size: 11 },
                    animation: { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200 },
                    layout: { padding: { top: 18, right: 12, bottom: 6, left: 4 } },
                    elements: { bar: { borderRadius: 2 }, arc: { borderWidth: 2, borderColor: '#17181b', hoverOffset: 4 } },
                    ...options,
                    ...(options?.scales ? { scales: Object.fromEntries(Object.entries(options.scales).map(([key, axis]) => [key, {
                        ...axis, border: { display: false, ...axis.border },
                        grid: { color: '#2e3138', drawTicks: false, ...axis.grid },
                        ticks: { color: '#989fa9', padding: 8, ...axis.ticks },
                    }])) } : {}),
                    plugins: {
                        ...options?.plugins,
                        legend: { position: 'bottom', ...options?.plugins?.legend, labels: { color: '#b8bec8', usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14, font: { size: 11 }, ...options?.plugins?.legend?.labels } },
                        tooltip: { backgroundColor: '#17181b', titleColor: '#f3f4f6', bodyColor: '#b8bec8', borderColor: '#2e3138', borderWidth: 1, padding: 10, cornerRadius: 2, usePointStyle: true, ...options?.plugins?.tooltip },
                        datalabels: {
                            display: showLabels ? function(context) { return context.dataset.data[context.dataIndex] > 0; } : false,
                            color: '#f3f4f6',
                            font: { weight: 'bold', size: 10 },
                            textStrokeColor: '#101113',
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
                    <div className="absolute top-1 right-1 flex gap-1 opacity-70 hover:opacity-100 focus-within:opacity-100 transition-opacity z-10">
                        <button onClick={downloadExcel} className="p-1.5 bg-[#17181b] hover:bg-[#235d42] text-[#3da372] hover:text-white rounded-sm border border-[#2e3138] transition-colors" title="Завантажити звіт в Excel (сирі дані + діаграма)">
                            <Icon name="table" className="w-4 h-4" />
                        </button>
                        <button onClick={downloadImage} className="p-1.5 bg-[#17181b] hover:bg-[#222429] text-[#b8bec8] hover:text-[#f3f4f6] rounded-sm border border-[#2e3138] transition-colors" title="Завантажити графік як зображення (PNG)">
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

        const parseSafeDate = parseMedicalDate;

        const calculateWaitTimeUI = medicalWaitTime;

        const getBadgeColors = (lossType, severity, awolStatus) => {
            if (lossType === "Загибель (200)") return "bg-[#222429] text-[#f3f4f6] border-[#3c404a]";
            if (lossType === "Небойова смерть (200)") return "bg-[#222429] text-[#b8bec8] border-[#3c404a]";
            if (lossType === "200 (від ран)") return "bg-[#222429] text-[#f3f4f6] border-[#3c404a]";
            if (lossType === "Зниклий безвісти (ЗБВ)") return "bg-[#4c8ed9]/15 text-[#6fa8e6] border-[#4c8ed9]/50";
            if (lossType === "Повернення з СЗЧ" || (isAwol(lossType) && awolStatus === "Повернувся")) return "bg-[#3da372]/15 text-[#3da372] border-[#3da372]/50";
            if (lossType === "СЗЧ") return "bg-[#8f5fb8]/15 text-[#c084fc] border-[#8f5fb8]/50";
            if (lossType === "Дезертирство") return "bg-[#8f5fb8]/20 text-[#d8b4fe] border-[#8f5fb8]/60";
            if (severity === "Критичний") return "bg-[#8f5fb8]/20 text-[#d8b4fe] border-[#8f5fb8]/60";
            if (severity === "Важкий") return "bg-[#d9534f]/20 text-[#f3a3a0] border-[#d9534f]/60";
            if (severity === "Середній") return "bg-[#d99b26]/15 text-[#d99b26] border-[#d99b26]/50";
            return "bg-[#3da372]/15 text-[#3da372] border-[#3da372]/50";
        };

        const getLogRowStyle = (action, details) => {
            const aLow = action.toLowerCase(), dLow = details.toLowerCase();
            if (aLow.includes("евак") || dLow.includes("евак")) return "bg-[#4c8ed9]/10 border-[#4c8ed9]/30 text-[#f3f4f6] hover:bg-[#4c8ed9]/15";
            if (dLow.includes("200") || dLow.includes("збв") || dLow.includes("сзч") || dLow.includes("дезерт") || dLow.includes("загиб") || dLow.includes("смерть") || aLow.includes("видалення")) return "bg-[#d9534f]/10 border-[#d9534f]/30 text-[#f3a3a0] hover:bg-[#d9534f]/15";
            if (dLow.includes("300") || dLow.includes("травм") || dLow.includes("поран") || dLow.includes("важк") || dLow.includes("критич")) return "bg-[#d99b26]/10 border-[#d99b26]/30 text-[#f3f4f6] hover:bg-[#d99b26]/15";
            return "bg-[#17181b] border-[#2e3138] text-[#b8bec8] hover:bg-[#222429]";
        };

        const formatLogTime = (isoStr) => {
            try {
                const d = new Date(isoStr);
                const pad = n => String(n).padStart(2, '0');
                return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${String(d.getFullYear()).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            } catch { return isoStr.replace('T',' ').substring(0,19); }
        };
        
        const getInjStrUI = (inj) => describeInjuries(inj, BODY_REGIONS);

        // --- УНІВЕРСАЛЬНІ UI КОМПОНЕНТИ ---
        const FilterSection = ({ title, isOpen, toggle, onSelectAll, onClearAll, children }) => (
            <div className="space-y-1">
                <div className="flex items-center justify-between cursor-pointer select-none group" onClick={toggle}>
                    <span className="text-[11px] text-[#b8bec8] font-semibold uppercase tracking-wider group-hover:text-[#f3f4f6] transition-colors">{title}</span>
                    <div className="flex items-center gap-1.5">
                        {onSelectAll && onClearAll && isOpen && (
                            <div className="flex items-center gap-1 font-mono text-[10px]">
                                <button type="button" onClick={(e) => { e.stopPropagation(); onSelectAll(); }} className="text-[#4c8ed9] hover:text-white hover:bg-[#222429] px-1.5 py-0.5 rounded-sm bg-[#101113] border border-[#2e3138] transition-colors cursor-pointer" title="Обрати всі">Всі</button>
                                <button type="button" onClick={(e) => { e.stopPropagation(); onClearAll(); }} className="text-[#b8bec8] hover:text-[#f3a3a0] hover:bg-[#222429] px-1.5 py-0.5 rounded-sm bg-[#101113] border border-[#2e3138] transition-colors cursor-pointer" title="Зняти всі">Зняти</button>
                            </div>
                        )}
                        <Icon name={isOpen ? "chevron-up" : "chevron-down"} className="w-3.5 h-3.5 text-[#989fa9] group-hover:text-[#f3f4f6]" />
                    </div>
                </div>
                {isOpen && <div className="mt-1">{children}</div>}
            </div>
        );

        const CheckboxList = ({ items, selected, toggle, onSelectOnly, maxH = true }) => (
            <div className={`flex flex-col gap-1 bg-[#101113] p-2 rounded-sm border border-[#2e3138] ${maxH ? 'max-h-56 overflow-y-auto' : ''}`}>
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
                                    className="rounded-sm bg-[#17181b] border-[#2e3138] text-[#4c8ed9] focus:ring-0 w-3.5 h-3.5 cursor-pointer shrink-0" 
                                />
                                <span className={`whitespace-nowrap transition-colors text-xs ${isChecked ? 'text-[#f3f4f6] font-medium' : 'text-[#b8bec8]'}`}>{label}</span>
                            </label>
                            {onSelectOnly && (
                                <button 
                                    type="button" 
                                    onClick={(e) => { e.stopPropagation(); onSelectOnly(key); }}
                                    className="opacity-0 group-hover/row:opacity-100 focus:opacity-100 text-[10px] font-mono text-[#4c8ed9] hover:text-white px-1.5 py-0.5 rounded-sm bg-[#17181b] hover:bg-[#222429] border border-[#2e3138] transition-colors cursor-pointer shrink-0"
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
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-sm border text-xs font-medium transition-colors cursor-pointer select-none ${
                            isCustom 
                                ? 'bg-[#2b67ab]/20 border-[#4c8ed9] text-[#f3f4f6]' 
                                : isZero 
                                ? 'bg-[#d9534f]/15 border-[#d9534f]/60 text-[#f3a3a0]' 
                                : 'bg-[#101113] border-[#2e3138] text-[#b8bec8] hover:text-[#f3f4f6] hover:border-[#3c404a]'
                        }`}
                    >
                        <span>{title}</span>
                        <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded-sm border font-semibold tabular-nums ${
                            isCustom 
                                ? 'bg-[#2b67ab]/30 text-[#f3f4f6] border-[#4c8ed9]/50' 
                                : isZero 
                                ? 'bg-[#d9534f]/20 text-[#f3a3a0] border-[#d9534f]/40' 
                                : 'bg-[#17181b] text-[#b8bec8] border-[#2e3138]'
                        }`}>
                            {count === total ? 'Всі' : count === 0 ? '0' : `${count}`}
                        </span>
                        <Icon name="chevron-down" className={`w-3 h-3 text-[#989fa9] transition-transform ${isOpen ? 'rotate-180 text-[#4c8ed9]' : ''}`} />
                    </button>
                    {isOpen && (
                        <>
                            <div className="fixed inset-0 z-40 cursor-default" onClick={onToggle}></div>
                            <div className="absolute top-full left-0 mt-1 w-max min-w-[280px] max-w-[calc(100vw-32px)] bg-[#17181b] border border-[#2e3138] rounded-sm p-3 z-50 space-y-2.5">
                                <div className="flex items-center justify-between pb-2 border-b border-[#2e3138]">
                                    <span className="text-[11px] font-semibold text-[#f3f4f6] uppercase tracking-wider">{title}</span>
                                    <div className="flex gap-1.5 text-[10px] font-mono">
                                        {onSelectAll && <button type="button" onClick={onSelectAll} className="text-[#4c8ed9] hover:text-white px-2 py-0.5 rounded-sm bg-[#101113] border border-[#2e3138] hover:bg-[#222429] cursor-pointer">Всі</button>}
                                        {onClearAll && <button type="button" onClick={onClearAll} className="text-[#f3a3a0] hover:text-white px-2 py-0.5 rounded-sm bg-[#101113] border border-[#2e3138] hover:bg-[#222429] cursor-pointer">Зняти</button>}
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

        function formatRankShortUI(rank) {
            if (!rank || rank === 'Не вказано' || rank === 'Невідомо') return 'В/сл';
            const r = rank.trim();
            const map = {
                'Старший солдат': 'Ст. солдат',
                'Молодший сержант': 'Мол. сержант',
                'Старший сержант': 'Ст. сержант',
                'Головний сержант': 'Гол. сержант',
                'Штаб-сержант': 'Шт.-серж.',
                'Майстер-сержант': 'Майстер-серж.',
                'Молодший лейтенант': 'Мол. лейтенант',
                'Старший лейтенант': 'Ст. лейтенант'
            };
            return map[r] || r;
        }

        const copyToClipboardSafe = (text, onSuccess) => {
            let copied = false;
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                copied = document.execCommand('copy');
                document.body.removeChild(ta);
            } catch (e) {
                copied = false;
            }
            if (copied) {
                if (onSuccess) onSuccess();
            } else if (navigator?.clipboard?.writeText) {
                navigator.clipboard.writeText(text).then(() => {
                    if (onSuccess) onSuccess();
                }).catch(() => {});
            }
        };

        const formatSoldierReportLine = (episode, soldier, index = null) => {
            const displayRank = episode.rank || soldier?.rank || '';
            const cleanRank = (!displayRank || displayRank === 'Не вказано' || displayRank === 'Невідомо') ? 'В/сл' : formatRankShortUI(displayRank);
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
            } else if (isAwolReturnEp(episode)) {
                charStr = episode.lossType === 'Дезертирство' ? 'Повернення (Дезертирство)' : 'Повернення з СЗЧ';
            }

            const injPart = injStr ? ` — ${injStr}` : '';
            const udpPart = episode.inUdp ? ' [УПД]' : '';
            const reportPart = episode.hasReport ? ' [Рапорт]' : '';

            // Статус евакуації
            let evacStr = 'Не евакуйований';
            const isAwolType = isAwol(episode.lossType);
            const isEvac = episode.evacStatus === "Евакуйований";
            if (isAwolType) {
                evacStr = isAwolReturnEp(episode) ? 'Повернувся' : (episode.awolStatus || 'СЗЧ');
            } else if (isEvac || episode.awolStatus === "Повернувся") {
                evacStr = 'Евакуйований';
            } else {
                evacStr = 'Не евакуйований';
            }

            const numPrefix = index !== null ? `${index}. ` : '';
            
            // Структурований 2-рядковий блок (Варіант 2)
            return `${numPrefix}${sName}${sCallsign} (${cleanRank}, ${unitStr})\n   • ${charStr}${injPart}${udpPart}${reportPart} | ${evacStr}\n   • Подія: ${dateStr}${causeStr} | Факт: ${factStr}${docStr}`;
        };

        const EMPTY_EPISODES = [];

        const EpisodeCard = React.memo(({ episode, soldier: baseSoldier, soldierEpisodes = EMPTY_EPISODES, onEdit, onNotify, viewMode = 'grid', onReview, clockTick }) => {
            const soldier = MedicalPersonnelDirectory.forEpisode(episode, baseSoldier);
            const [isCopied, setIsCopied] = React.useState(false);
            const handleReview = React.useCallback(() => { if (onReview) onReview(episode.soldierId); }, [onReview, episode.soldierId]);
            const isReturnedAwol = isAwolReturnEp(episode);
            const badgeClass = getBadgeColors(episode.lossType, episode.severity, episode.awolStatus);
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
                evacCopyStr = isReturnedAwol
                    ? (evacFormattedDate ? `Повернувся (${evacFormattedDate})` : 'Повернувся')
                    : (episode.awolStatus || 'СЗЧ');
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
                episode.lossType === 'Зниклий безвісті (ЗБВ)' || episode.lossType === 'Зниклий безвісти (ЗБВ)' ? 'bg-blue-500' :
                isReturnedAwol ? 'bg-emerald-500' :
                isAwol(episode.lossType) ? 'bg-fuchsia-500' :
                episode.severity === 'Критичний' ? 'bg-purple-500' :
                episode.severity === 'Важкий' ? 'bg-red-500' :
                episode.severity === 'Середній' ? 'bg-amber-500' :
                episode.severity === 'Легкий' ? 'bg-[#3da372]' : 'bg-[#3c404a]';

            const isRankMissing = !displayRank || displayRank === 'Не вказано' || displayRank === 'Невідомо';
            const cleanRank = isRankMissing ? 'В/сл' : formatRankShortUI(displayRank);

            const handleCopySummary = (e) => {
                e.stopPropagation();
                const epWithWait = { ...episode, waitStr: isWaitValid ? waitStr : '' };
                const textToCopy = formatSoldierReportLine(epWithWait, soldier);
                copyToClipboardSafe(textToCopy, () => {
                    setIsCopied(true);
                    setTimeout(() => setIsCopied(false), 2000);
                    if (onNotify) onNotify("Дані бійця скопійовано!", "success");
                });
            };

            const renderEvacBadge = (widthClass = "w-52 xl:w-[228px]") => {
                if (isAwol(episode.lossType)) {
                    if (isReturnedAwol) {
                        return (
                            <div className={`${widthClass} text-center text-xs font-medium px-2.5 py-1 rounded-sm bg-[#3da372]/15 border border-[#3da372]/40 text-[#3da372] flex items-center justify-center gap-1.5 whitespace-nowrap`}>
                                <Icon name="check-circle" className="w-3.5 h-3.5 text-[#3da372] shrink-0" />
                                <span className="truncate">Повернувся</span>
                                {evacFormattedDate && <span className="font-mono font-semibold text-[11px] tabular-nums">({evacFormattedDate})</span>}
                            </div>
                        );
                    }
                    return (
                        <div className={`${widthClass} text-center text-xs font-medium px-2.5 py-1 rounded-sm bg-[#101113] border border-[#2e3138] text-[#c084fc] flex items-center justify-center gap-1.5 whitespace-nowrap`}>
                            <Icon name="user-x" className="w-3.5 h-3.5 text-[#c084fc] shrink-0" />
                            <span className="truncate">{episode.awolStatus || 'СЗЧ'}</span>
                        </div>
                    );
                }

                if (isEvac || episode.awolStatus === "Повернувся") {
                    return (
                        <div className={`${widthClass} text-center text-xs font-medium px-2.5 py-1 rounded-sm bg-[#101113] border border-[#2e3138] text-[#f3f4f6] flex items-center justify-center gap-1.5 whitespace-nowrap`}>
                            <Icon name="check-circle" className="w-3.5 h-3.5 text-[#3da372] shrink-0" />
                            <span>Евакуйований</span>
                            {evacFormattedDate && <span className="text-[#3da372] font-mono font-semibold text-[11px] tabular-nums">({evacFormattedDate})</span>}
                        </div>
                    );
                }

                // Не евакуйований: темний бейдж з червоним таймером
                return (
                    <div className={`${widthClass} text-center text-xs font-medium px-2.5 py-1 rounded-sm bg-[#101113] border border-[#2e3138] text-[#f3f4f6] flex items-center justify-center gap-1.5 whitespace-nowrap`}>
                        <Icon name="ambulance" className="w-3.5 h-3.5 text-[#f3a3a0] shrink-0" />
                        <span>Не евакуйований</span>
                        {isWaitValid && <span className="text-[#f3a3a0] font-mono font-semibold text-[11px] tabular-nums">({waitStr})</span>}
                    </div>
                );
            };

            if (viewMode === 'list') {
                const listMidGridClass = "grid grid-cols-1 sm:grid-cols-[minmax(160px,1.25fr)_minmax(125px,1fr)_minmax(125px,1fr)] xl:grid-cols-[minmax(220px,255px)_minmax(150px,180px)_minmax(140px,1fr)] 2xl:grid-cols-[275px_195px_minmax(180px,1fr)] items-center gap-3";
                return (
                    <div 
                        onClick={() => onEdit(episode)} 
                        className="bg-[#17181b] border border-[#3a3e47] hover:border-[#4c8ed9] hover:bg-[#222429] rounded-sm p-3 flex flex-col lg:flex-row items-stretch justify-between gap-3.5 group transition-colors relative overflow-hidden cursor-pointer"
                        title="Клікніть для редагування запису"
                    >
                        {/* 1. Ліва колонка: Боєць + Кнопки дій */}
                        <div className="flex items-center gap-2.5 w-full lg:w-[400px] xl:w-[440px] 2xl:w-[470px] shrink-0">
                            <div className="flex items-center gap-1 shrink-0">
                                <button 
                                    type="button" 
                                    onClick={(e) => { e.stopPropagation(); onEdit(episode); }} 
                                    className="w-8 h-8 rounded-sm bg-[#101113] hover:bg-[#2b67ab]/25 border border-[#3a3e47] hover:border-[#4c8ed9] text-[#b4c0d0] group-hover:text-[#7eb6f2] flex items-center justify-center transition-colors cursor-pointer"
                                    title="Редагувати запис"
                                >
                                    <Icon name="edit-3" className="w-3.5 h-3.5" />
                                </button>
                                <button 
                                    type="button" 
                                    onClick={handleCopySummary}
                                    className={`w-8 h-8 rounded-sm border flex items-center justify-center transition-colors cursor-pointer ${
                                        isCopied 
                                            ? 'bg-[#3da372]/20 border-[#3da372] text-[#6ee7b7]' 
                                            : 'bg-[#101113] hover:bg-[#222429] border-[#3a3e47] text-[#b4c0d0] hover:text-white'
                                    }`}
                                    title={isCopied ? "Скопійовано в буфер!" : "Скопіювати короткий звіт по бійцю"}
                                >
                                    <Icon name={isCopied ? "check" : "copy"} className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-baseline gap-2 min-w-0">
                                    <span className="text-[#9ca3af] text-[11px] font-semibold shrink-0 uppercase tracking-wide">
                                        {cleanRank}
                                    </span>
                                    <span className="text-[#f9fafb] group-hover:text-[#38bdf8] font-bold text-[14.5px] tracking-tight truncate transition-colors" title={sName}>
                                        {sName}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-[#9ca3af] flex-wrap">
                                    {sCallsign && (
                                        <>
                                            <span className="text-[#fbbf24] text-xs font-mono font-bold shrink-0">
                                               «{formatCallsignUI(sCallsign)}»
                                            </span>
                                            <span className="text-[#464b57]">·</span>
                                        </>
                                    )}
                                    <span className="text-[#a5b4fc] font-semibold truncate max-w-[160px]" title={displayUnit}>
                                        {displayUnit || 'Не вказано'}
                                    </span>
                                    <span className="text-[#464b57]">·</span>
                                    <span className="text-[#d4d8e0] font-mono text-[11.5px] tabular-nums" title="Дата та час події">
                                        {dateDisplay}
                                    </span>
                                    <StatusHistoryChainBadge episodes={soldierEpisodes} onReview={handleReview} />
                                </div>
                            </div>
                        </div>

                        {/* 2. Середня колонка: Обставини/Локації (вгорі) та Травми/Теги (внизу) */}
                        <div className="flex-1 min-w-0 px-1 lg:border-l lg:border-[#2e3138] lg:pl-4 flex flex-col justify-center space-y-1.5">
                            {/* Рядок 1: Фіксована 3-колонкова сітка (Причина | Факт | Док) */}
                            <div className={`${listMidGridClass} text-[12.5px]`}>
                                <div className="min-w-0 flex items-center gap-1.5">
                                    <Icon name={isAwol(episode.lossType) ? "compass" : "target"} className="w-3.5 h-3.5 text-[#989fa9] shrink-0" />
                                    <div className="min-w-0 flex-1 truncate leading-5">
                                        <span className="text-[#989fa9] text-[10px] uppercase font-semibold tracking-wider mr-1.5">{isAwol(episode.lossType) ? "Звідки:" : "Причина:"}</span>
                                        <span className="font-medium text-[#f3f4f6]" title={episode.cause}>{episode.cause}</span>
                                    </div>
                                </div>

                                <div className="min-w-0 flex items-center gap-1.5">
                                    {isAwol(episode.lossType) ? (
                                        episode.actualLoc ? (
                                            <>
                                                <Icon name="map-pin" className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
                                                <div className="min-w-0 flex-1 truncate leading-5">
                                                    <span className="text-[#989fa9] text-[10px] uppercase font-semibold tracking-wider mr-1.5">Локація:</span>
                                                    <span className="text-[#38bdf8] font-semibold" title={episode.actualLoc}>{episode.actualLoc}</span>
                                                </div>
                                            </>
                                        ) : null
                                    ) : (
                                        <>
                                            <Icon name="map-pin" className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
                                            <div className="min-w-0 flex-1 truncate leading-5">
                                                <span className="text-[#989fa9] text-[10px] uppercase font-semibold tracking-wider mr-1.5">Факт:</span>
                                                <span className="text-[#38bdf8] font-semibold" title={episode.actualLoc}>{episode.actualLoc || "-"}</span>
                                            </div>
                                        </>
                                    )}
                                </div>

                                <div className="min-w-0 flex items-center gap-1.5">
                                    {isAwol(episode.lossType) && isReturnedAwol && evacFormattedDate ? (
                                        <>
                                            <Icon name="calendar" className="w-3.5 h-3.5 text-[#34d399] shrink-0" />
                                            <div className="min-w-0 flex-1 truncate leading-5">
                                                <span className="text-[#989fa9] text-[10px] uppercase font-semibold tracking-wider mr-1.5">Повернення:</span>
                                                <span className="text-[#34d399] font-mono font-semibold tabular-nums">{evacFormattedDate}</span>
                                            </div>
                                        </>
                                    ) : episode.docLoc ? (
                                        <>
                                            <Icon name="file-text" className="w-3.5 h-3.5 text-[#c4b5fd] shrink-0" />
                                            <div className="min-w-0 flex-1 truncate leading-5">
                                                <span className="text-[#989fa9] text-[10px] uppercase font-semibold tracking-wider mr-1.5">Док:</span>
                                                <span className="text-[#c4b5fd] font-medium" title={episode.docLoc}>{episode.docLoc}</span>
                                            </div>
                                        </>
                                    ) : null}
                                </div>
                            </div>

                            {/* Рядок 2: Травми (Колонка 1) | Під час УПД (Колонка 2) | Рапорт / Зброя (Колонка 3) */}
                            {(injStr || episode.inUdp || episode.hasReport || episode.weaponStatus) && (
                                <div className={`${listMidGridClass} pt-0.5 min-w-0`}>
                                    {/* Колонка 1: Травми */}
                                    <div className="min-w-0 flex items-center gap-1.5">
                                        {injStr ? (
                                            <>
                                                <Icon name="activity" className="w-3 h-3 text-[#fda4af] shrink-0" />
                                                <div className="min-w-0 flex-1 truncate leading-5">
                                                    <span className="font-semibold text-[#989fa9] text-[10px] uppercase tracking-wider mr-1.5">Травми:</span>
                                                    <span className="text-[#fda4af] font-medium text-[11.5px]" title={injStr}>{injStr}</span>
                                                </div>
                                            </>
                                        ) : null}
                                    </div>

                                    {/* Колонка 2: Під час УПД */}
                                    <div className="min-w-0 flex items-center">
                                        {episode.inUdp ? (
                                            <span className="w-fit text-[10px] bg-[#d9534f]/15 text-[#f3a3a0] border border-[#d9534f]/40 px-2 py-0.5 rounded-sm font-medium flex items-center gap-1 shrink-0" title="Отримано під час УПД">
                                                <Icon name="zap" className="w-2.5 h-2.5 text-[#f3a3a0]" /> Під час УПД
                                            </span>
                                        ) : null}
                                    </div>

                                    {/* Колонка 3: Рапорт та Зброя */}
                                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                        {episode.hasReport && (
                                            <span className="text-[10px] bg-[#4c8ed9]/15 text-[#6fa8e6] border border-[#4c8ed9]/40 px-2 py-0.5 rounded-sm font-medium flex items-center gap-1 shrink-0" title="Складено офіційний рапорт">
                                                <Icon name="file-check-2" className="w-2.5 h-2.5 text-[#4c8ed9]" /> Рапорт
                                            </span>
                                        )}
                                        {episode.weaponStatus && (
                                            <span 
                                                className={`text-[10px] border px-2 py-0.5 rounded-sm font-medium flex items-center gap-1 shrink-0 ${
                                                    episode.weaponStatus === "СЗЧ/Дезертирство зі зброєю" ? "bg-[#d9534f]/15 text-[#f3a3a0] border-[#d9534f]/40" : 
                                                    episode.weaponStatus === "знаходиться у підрозділі" ? "bg-[#4c8ed9]/15 text-[#6fa8e6] border-[#4c8ed9]/40" :
                                                    "bg-[#d99b26]/15 text-[#d99b26] border-[#d99b26]/40"
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

                        {/* 3. Права колонка: Статус втрати та евакуація */}
                        <div className="flex flex-col items-end justify-center gap-1.5 shrink-0 lg:border-l lg:border-[#2e3138] lg:pl-3.5">
                            <span className={`w-52 xl:w-[228px] text-center text-xs uppercase font-semibold tracking-wide px-2.5 py-1 rounded-sm border whitespace-nowrap truncate ${badgeClass}`}>
                                {isAny300(episode.lossType) ? `${episode.lossType.split(' ')[0]} (${episode.severity})` : isReturnedAwol ? (episode.lossType === "Дезертирство" ? "Повернення (Дезерт.)" : "Повернення з СЗЧ") : episode.lossType}
                            </span>
                            {renderEvacBadge("w-52 xl:w-[228px]")}
                        </div>
                    </div>
                );
            }

            // Grid (2-col) view
            return (
                <div 
                    onClick={() => onEdit(episode)} 
                    className="bg-[#17181b] border border-[#3a3e47] hover:border-[#4c8ed9] hover:bg-[#222429] rounded-sm p-3.5 flex flex-col justify-between gap-3 group transition-colors relative overflow-hidden cursor-pointer"
                    title="Клікніть для редагування запису"
                >
                    {/* Верхня частина: Фіксовані кнопки + Звання, ПІБ, Позивний + Статуси */}
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="flex items-center gap-1 shrink-0">
                                <button 
                                    type="button" 
                                    onClick={(e) => { e.stopPropagation(); onEdit(episode); }} 
                                    className="w-8 h-8 rounded-sm bg-[#101113] hover:bg-[#2b67ab]/20 border border-[#3a3e47] hover:border-[#4c8ed9] text-[#b8bec8] group-hover:text-[#4c8ed9] flex items-center justify-center transition-colors cursor-pointer"
                                    title="Редагувати запис"
                                >
                                    <Icon name="edit-3" className="w-3.5 h-3.5" />
                                </button>
                                <button 
                                    type="button" 
                                    onClick={handleCopySummary}
                                    className={`w-8 h-8 rounded-sm border flex items-center justify-center transition-colors cursor-pointer ${
                                        isCopied 
                                            ? 'bg-[#3da372]/20 border-[#3da372] text-[#3da372]' 
                                            : 'bg-[#101113] hover:bg-[#25272d] border-[#3a3e47] text-[#b8bec8] hover:text-[#ffffff]'
                                    }`}
                                    title={isCopied ? "Скопійовано в буфер!" : "Скопіювати короткий звіт по бійцю"}
                                >
                                    <Icon name={isCopied ? "check" : "copy"} className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-baseline gap-2 min-w-0">
                                    <span className="text-[#9ca3af] text-[11px] font-semibold shrink-0 uppercase tracking-wide">
                                        {cleanRank}
                                    </span>
                                    <span className="text-[#f9fafb] group-hover:text-[#38bdf8] font-bold text-[14.5px] tracking-tight truncate transition-colors" title={sName}>
                                        {sName}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-[#9ca3af] flex-wrap">
                                    {sCallsign && (
                                        <>
                                            <span className="text-[#fbbf24] text-xs font-mono font-bold shrink-0">
                                                «{formatCallsignUI(sCallsign)}»
                                            </span>
                                            <span className="text-[#464b57]">·</span>
                                        </>
                                    )}
                                    <span className="text-[#a5b4fc] font-semibold truncate max-w-[160px]" title={displayUnit}>
                                        {displayUnit || 'Не вказано'}
                                    </span>
                                    <span className="text-[#464b57]">·</span>
                                    <span className="text-[#d4d8e0] font-mono text-[11.5px] tabular-nums">
                                        {dateDisplay}
                                    </span>
                                    <StatusHistoryChainBadge episodes={soldierEpisodes} onReview={handleReview} />
                                </div>
                            </div>
                        </div>

                        {/* Статуси вгорі */}
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <span className={`w-44 text-center text-xs uppercase font-semibold tracking-wide px-2 py-0.5 rounded-sm border ${badgeClass}`}>
                                {isAny300(episode.lossType) ? `${episode.lossType.split(' ')[0]} (${episode.severity})` : isReturnedAwol ? (episode.lossType === "Дезертирство" ? "Повернення (Дезерт.)" : "Повернення з СЗЧ") : episode.lossType}
                            </span>
                            {renderEvacBadge("w-44")}
                        </div>
                    </div>

                    {/* Середня частина: Матрична 3-колонкова сітка */}
                    <div className="pt-2 border-t border-[#32363e] space-y-1.5">
                        {/* Рядок 1: Причина | Факт | Док */}
                        <div className="grid grid-cols-1 sm:grid-cols-[minmax(160px,210px)_minmax(130px,160px)_minmax(130px,1fr)] items-center gap-2 text-xs">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <Icon name={isAwol(episode.lossType) ? "compass" : "target"} className="w-3.5 h-3.5 text-[#989fa9] shrink-0" />
                                <span className="text-[#989fa9] text-[10px] uppercase font-semibold tracking-wider shrink-0">{isAwol(episode.lossType) ? "Звідки:" : "Причина:"}</span>
                                <span className="font-medium text-[#f3f4f6] truncate" title={episode.cause}>{episode.cause}</span>
                            </div>
                            {isAwol(episode.lossType) ? (
                                episode.actualLoc ? (
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <Icon name="map-pin" className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
                                        <span className="text-[#989fa9] text-[10px] uppercase font-semibold tracking-wider shrink-0">Локація:</span>
                                        <span className="text-[#38bdf8] font-semibold truncate" title={episode.actualLoc}>{episode.actualLoc}</span>
                                    </div>
                                ) : <div />
                            ) : (
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <Icon name="map-pin" className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
                                    <span className="text-[#989fa9] text-[10px] uppercase font-semibold tracking-wider shrink-0">Факт:</span>
                                    <span className="text-[#38bdf8] font-semibold truncate" title={episode.actualLoc}>{episode.actualLoc || "-"}</span>
                                </div>
                            )}
                            {isAwol(episode.lossType) && isReturnedAwol && evacFormattedDate ? (
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <Icon name="calendar" className="w-3.5 h-3.5 text-[#34d399] shrink-0" />
                                    <span className="text-[#989fa9] text-[10px] uppercase font-semibold tracking-wider shrink-0">Повернення:</span>
                                    <span className="text-[#34d399] font-mono font-semibold truncate tabular-nums">{evacFormattedDate}</span>
                                </div>
                            ) : episode.docLoc ? (
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <Icon name="file-text" className="w-3.5 h-3.5 text-[#c4b5fd] shrink-0" />
                                    <span className="text-[#989fa9] text-[10px] uppercase font-semibold tracking-wider shrink-0">Док:</span>
                                    <span className="text-[#c4b5fd] font-medium truncate" title={episode.docLoc}>{episode.docLoc}</span>
                                </div>
                            ) : <div />}
                        </div>

                        {/* Рядок 2: Травми (Колонка 1) | Під час УПД (Колонка 2) | Рапорт / Зброя (Колонка 3) */}
                        {(injStr || episode.inUdp || episode.hasReport || episode.weaponStatus) && (
                            <div className="grid grid-cols-1 sm:grid-cols-[minmax(160px,210px)_minmax(130px,160px)_minmax(130px,1fr)] items-center gap-2 pt-0.5 min-w-0">
                                {/* Колонка 1: Травми */}
                                <div className="min-w-0 flex items-center gap-1.5">
                                    {injStr ? (
                                        <>
                                            <Icon name="activity" className="w-3 h-3 text-[#fda4af] shrink-0" />
                                            <span className="font-semibold text-[#989fa9] text-[10px] uppercase tracking-wider shrink-0">Травми:</span>
                                            <span className="text-[#fda4af] font-medium text-[11.5px] truncate" title={injStr}>{injStr}</span>
                                        </>
                                    ) : null}
                                </div>

                                {/* Колонка 2: Під час УПД */}
                                <div className="min-w-0">
                                    {episode.inUdp ? (
                                        <span className="w-fit text-[10px] bg-[#d9534f]/15 text-[#f3a3a0] border border-[#d9534f]/40 px-2 py-0.5 rounded-sm font-medium flex items-center gap-1 shrink-0" title="Отримано під час УПД">
                                            <Icon name="zap" className="w-2.5 h-2.5 text-[#f3a3a0]" /> Під час УПД
                                        </span>
                                    ) : null}
                                </div>

                                {/* Колонка 3: Рапорт та Зброя */}
                                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                    {episode.hasReport && (
                                        <span className="text-[10px] bg-[#4c8ed9]/15 text-[#6fa8e6] border border-[#4c8ed9]/40 px-2 py-0.5 rounded-sm font-medium flex items-center gap-1 shrink-0" title="Складено офіційний рапорт">
                                            <Icon name="file-check-2" className="w-2.5 h-2.5 text-[#4c8ed9]" /> Рапорт
                                        </span>
                                    )}
                                    {episode.weaponStatus && (
                                        <span 
                                            className={`text-[10px] border px-2 py-0.5 rounded-sm font-medium flex items-center gap-1 shrink-0 ${
                                                episode.weaponStatus === "СЗЧ/Дезертирство зі зброєю" ? "bg-[#d9534f]/15 text-[#f3a3a0] border-[#d9534f]/40" : 
                                                episode.weaponStatus === "знаходиться у підрозділі" ? "bg-[#4c8ed9]/15 text-[#6fa8e6] border-[#4c8ed9]/40" :
                                                "bg-[#d99b26]/15 text-[#d99b26] border-[#d99b26]/40"
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

        const TriageCard = React.memo(({ ep, soldier: baseSoldier, soldierEpisodes = EMPTY_EPISODES, onQuickEvac, onEdit, onAlertMIA, onNotify, onCreate200FromWounds, onReview, clockTick }) => {
            const soldier = MedicalPersonnelDirectory.forEpisode(ep, baseSoldier);
            const [isCopied, setIsCopied] = React.useState(false);
            const handleReview = React.useCallback(() => { if (onReview) onReview(ep.soldierId); }, [onReview, ep.soldierId]);
            const waitStr = calculateWaitTimeUI(ep.date);
            const injStr = getInjStrUI(ep.injuries);
            const displayRank = ep.rank || soldier?.rank || '';
            const displayUnit = ep.unit || soldier?.unit || '';
            const sName = soldier?.name || 'Невідомо';
            const sCallsign = soldier?.callsign || '';

            const isRankMissing = !displayRank || displayRank === 'Не вказано' || displayRank === 'Невідомо';
            const cleanRank = isRankMissing ? 'В/сл' : formatRankShortUI(displayRank);

            // Форматування короткого ПІБ для диспетчерської консолі (Прізвище І. Б.)
            const shortName = React.useMemo(() => {
                if (!sName || sName === 'Невідомо') return sName;
                const parts = sName.trim().split(/\s+/);
                if (parts.length >= 2) {
                    const surname = parts[0];
                    const initials = parts.slice(1).map(p => p[0].toUpperCase() + '.').join(' ');
                    return `${surname} ${initials}`;
                }
                return sName;
            }, [sName]);

            const statusHistoryBadge = <StatusHistoryChainBadge episodes={soldierEpisodes} onReview={handleReview} />;

            const leftAccentColor = 
                isAny200(ep.lossType) ? 'bg-[#989fa9]' :
                ep.lossType === 'Зниклий безвісті (ЗБВ)' ? 'bg-[#4c8ed9]' :
                isAwol(ep.lossType) ? 'bg-[#8f5fb8]' :
                ep.severity === 'Критичний' ? 'bg-[#8f5fb8]' :
                ep.severity === 'Важкий' ? 'bg-[#d9534f]' :
                ep.severity === 'Середній' ? 'bg-[#d99b26]' :
                ep.severity === 'Легкий' ? 'bg-[#3da372]' : 'bg-[#989fa9]';

            const timerBadgeColor =
                ep.severity === 'Критичний' ? 'bg-[#8f5fb8]/15 text-[#d8b4fe] border-[#8f5fb8]/50' :
                ep.severity === 'Важкий' ? 'bg-[#d9534f]/15 text-[#f3a3a0] border-[#d9534f]/50' :
                ep.severity === 'Середній' ? 'bg-[#d99b26]/15 text-[#d99b26] border-[#d99b26]/50' :
                ep.severity === 'Легкий' ? 'bg-[#3da372]/15 text-[#3da372] border-[#3da372]/50' :
                'bg-[#101113] text-[#b8bec8] border-[#2e3138]';

            const handleCopySummary = (e) => {
                e.stopPropagation();
                const epWithWait = { ...ep, waitStr: waitStr !== 'Невідомо' ? waitStr : '' };
                const textToCopy = formatSoldierReportLine(epWithWait, soldier);
                copyToClipboardSafe(textToCopy, () => {
                    setIsCopied(true);
                    setTimeout(() => setIsCopied(false), 2000);
                    if (onNotify) onNotify("Дані бійця скопійовано!", "success");
                });
            };
            
            return (
                <div 
                    onClick={() => onEdit(ep)}
                    className="bg-[#17181b] border border-[#2e3138] hover:border-[#4c8ed9] hover:bg-[#222429] p-2.5 rounded-sm flex flex-col gap-1.5 relative overflow-hidden group transition-colors cursor-pointer"
                    title="Клікніть для редагування запису"
                >
                    <div className={`absolute top-0 left-0 w-1 h-full ${leftAccentColor}`}></div>
                    
                    {/* Рядок 1: Позивний, ПІБ (скорочено), Звання, Підрозділ + Таймер */}
                    <div className="pl-1.5 flex justify-between items-center gap-2 min-w-0">
                        <div className="min-w-0 flex-1 flex items-center gap-1.5 overflow-hidden">
                            {sCallsign ? (
                                <span className="text-[#d99b26] text-xs font-mono font-semibold bg-[#d99b26]/10 border border-[#d99b26]/40 px-1.5 py-0.5 rounded-sm shrink-0">
                                    «{formatCallsignUI(sCallsign)}»
                                </span>
                            ) : null}
                            <span className="text-sm font-semibold text-[#f3f4f6] group-hover:text-[#4c8ed9] truncate min-w-[70px] shrink transition-colors" title={sName}>
                                {shortName}
                            </span>
                            <span className="text-[#b8bec8] text-[10px] font-medium bg-[#101113] border border-[#2e3138] px-1.5 py-0.5 rounded-sm shrink-0" title={displayRank}>
                                {cleanRank}
                            </span>
                            <span className="text-[#b8bec8] text-xs shrink-0 max-w-[80px] truncate" title={displayUnit}>
                                {displayUnit || 'Не вказано'}
                            </span>
                        </div>

                        {/* Таймер очікування */}
                        <div className={`text-[10px] font-semibold font-mono tabular-nums px-1.5 py-0.5 rounded-sm border flex items-center gap-1 shrink-0 ${timerBadgeColor}`}>
                            <Icon name="clock" className="w-2.5 h-2.5 text-[#d99b26] shrink-0" />
                            <span>{waitStr}</span>
                        </div>
                    </div>

                    {/* Рядок 2: Травми або Характер втрати + Ланцюжок статусів */}
                    <div className="pl-1.5 flex items-center justify-between gap-1.5 min-w-0">
                        <div className="min-w-0 flex-1 truncate flex items-center gap-1">
                            {isAny300(ep.lossType) ? (
                                injStr ? (
                                    <span className="text-[#f3a3a0] font-medium text-[11px] truncate flex items-center gap-1 min-w-0" title={injStr}>
                                        <Icon name="activity" className="w-3 h-3 text-[#f3a3a0] shrink-0" />
                                        <span className="truncate">{injStr}</span>
                                    </span>
                                ) : (
                                    <span className="text-[#b8bec8] text-[11px] truncate">{ep.lossType}</span>
                                )
                            ) : (
                                <span className="text-[#f3f4f6] font-medium text-[11px] truncate flex items-center gap-1 min-w-0">
                                    <Icon name="shield-alert" className="w-3 h-3 text-[#b8bec8] shrink-0" />
                                    <span className="truncate">{ep.lossType}</span>
                                </span>
                            )}
                        </div>
                        {statusHistoryBadge}
                    </div>

                    {/* Рядок 3: Локація + Кнопки дій */}
                    <div className="pl-1.5 flex justify-between items-center gap-2 pt-1 border-t border-[#2e3138] min-w-0">
                        <div className="min-w-0 flex-1 flex items-center gap-1.5 text-xs overflow-hidden">
                            <span className="text-[#f3f4f6] text-[11px] truncate flex items-center gap-1 shrink-0 max-w-[140px]" title={ep.actualLoc ? `Локація: ${ep.actualLoc}` : "Локація не вказана"}>
                                <Icon name="map-pin" className="w-3 h-3 text-[#d99b26] shrink-0" />
                                <span className="truncate">{ep.actualLoc || "-"}</span>
                            </span>

                            {ep.inUdp && (
                                <span className="text-[9px] bg-[#d9534f]/15 text-[#f3a3a0] border border-[#d9534f]/40 px-1 py-0.5 rounded-sm font-semibold tracking-wide shrink-0">
                                    УПД
                                </span>
                            )}
                        </div>

                        {/* Кнопки дій */}
                        <div className="flex items-center gap-1 shrink-0">
                            {ep.lossType === 'Зниклий безвісті (ЗБВ)' ? (
                                <button 
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onAlertMIA(); }} 
                                    className="py-1 px-2 bg-[#101113] hover:bg-[#4c8ed9]/20 hover:border-[#4c8ed9] text-[#6fa8e6] hover:text-white text-[11px] font-medium rounded-sm border border-[#2e3138] transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                    <Icon name="alert-triangle" className="w-3 h-3 text-[#4c8ed9]" /> 
                                    <span>ЗБВ</span>
                                </button>
                            ) : isAny200(ep.lossType) ? (
                                <button 
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onQuickEvac(ep); }} 
                                    className="py-1 px-2 bg-[#101113] hover:bg-[#2e3138] hover:border-[#3c404a] text-[#f3f4f6] text-[11px] font-medium rounded-sm border border-[#2e3138] transition-colors flex items-center gap-1 cursor-pointer group/btn"
                                    title="Позначити тіло евакуйованим"
                                >
                                    <Icon name="check-circle" className="w-3 h-3 text-[#b8bec8] group-hover/btn:text-white transition-colors" /> 
                                    <span>Тіло</span>
                                </button>
                            ) : (
                                <>
                                    <button 
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); onQuickEvac(ep); }} 
                                        className="py-1 px-2.5 bg-[#235d42] hover:bg-[#2b7251] text-[#f3f4f6] hover:text-white text-[11px] font-medium rounded-sm border border-[#3da372]/50 transition-colors flex items-center gap-1 cursor-pointer group/btn"
                                        title="Позначити бійця евакуйованим"
                                    >
                                        <Icon name="check-circle" className="w-3 h-3 text-[#3da372] group-hover/btn:text-white transition-colors" /> 
                                        <span>Евакуювати</span>
                                    </button>
                                    {isAny300(ep.lossType) && (
                                        <button 
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); onCreate200FromWounds && onCreate200FromWounds(ep); }} 
                                            className="py-1 px-2 bg-[#101113] hover:bg-[#222429] text-[#b8bec8] hover:text-[#f3f4f6] text-[11px] font-medium rounded-sm border border-[#2e3138] transition-colors flex items-center gap-1 cursor-pointer"
                                            title="Створити запис про смерть від ран (200)"
                                        >
                                            <Icon name="skull" className="w-3 h-3 text-[#b8bec8]" /> 
                                            <span>200(пвр)</span>
                                        </button>
                                    )}
                                </>
                            )}

                            <button 
                                type="button" 
                                onClick={handleCopySummary}
                                className={`w-7 h-7 rounded-sm border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                                    isCopied 
                                        ? 'bg-[#3da372]/20 border-[#3da372] text-[#3da372]' 
                                        : 'bg-[#101113] hover:bg-[#222429] border-[#2e3138] text-[#b8bec8] hover:text-[#f3f4f6]'
                                }`}
                                title={isCopied ? "Скопійовано в буфер!" : "Скопіювати звіт"}
                            >
                                <Icon name={isCopied ? "check" : "copy"} className="w-3 h-3" />
                            </button>

                            <button 
                                type="button" 
                                onClick={(e) => { e.stopPropagation(); onEdit(ep); }} 
                                className="w-7 h-7 rounded-sm bg-[#101113] hover:bg-[#2b67ab]/20 text-[#b8bec8] hover:text-[#4c8ed9] border border-[#2e3138] hover:border-[#4c8ed9] flex items-center justify-center transition-colors cursor-pointer shrink-0" 
                                title="Редагувати запис"
                            >
                                <Icon name="edit-3" className="w-3 h-3" />
                            </button>
                        </div>
                    </div>
                </div>
            );
        });

        function App() {
            const dictionaryOptions = useSharedDictionaries();
            const [isLoading, setIsLoading] = useState(true);
            const [soldiers, setSoldiers] = useState([]);
            const [episodes, setEpisodes] = useState([]);
            const [personMatches, setPersonMatches] = useState(null);
            const [chronologyReview, setChronologyReview] = useState(null);
            const dateIssues = useMemo(() => chronologyIssues(episodes), [episodes]);
            const soldiersMap = useMemo(() => {
                const map = new Map();
                soldiers.forEach(s => map.set(s.id, s));
                return map;
            }, [soldiers]);

            const openChronology = useCallback((soldierId, draft = null) => {
                const persisted = episodes.filter(ep => ep.soldierId === soldierId);
                setChronologyReview({ soldierId, draftId: draft?.id, persisted, name: soldiersMap.get(soldierId)?.name || 'Перевірка записів', rows: [...persisted.filter(ep => ep.id !== draft?.id), ...(draft ? [draft] : [])] });
            }, [episodes, soldiersMap]);
            const checkChronology = draft => {
                const rows = [...episodes.filter(ep => ep.soldierId === draft.soldierId && ep.id !== draft.id), draft];
                if (!chronologyIssues(rows).length) return true;
                openChronology(draft.soldierId, draft); return false;
            };
            const applyChronology = changes => {
                const current = episodes.filter(ep => ep.soldierId === chronologyReview.soldierId);
                if (JSON.stringify(current) !== JSON.stringify(chronologyReview.persisted)) throw new Error('Записи змінилися. Закрийте перевірку й відкрийте її знову.');
                const proposed = chronologyReview.rows.map(ep => ({ ...ep, date: changes[ep.id] ?? ep.date }));
                if (chronologyIssues(proposed).length) throw new Error('Спочатку усуньте суперечності дат.');
                const persistedChanges = current.filter(ep => ep.id !== chronologyReview.draftId && changes[ep.id]);
                if (persistedChanges.length) {
                    saveHistory();
                    setEpisodes(previous => previous.map(ep => persistedChanges.some(row => row.id === ep.id) ? { ...ep, date: changes[ep.id] } : ep));
                    addLog('Виправлення дат', persistedChanges.map(ep => ep.lossType + ': ' + ep.date + ' → ' + changes[ep.id]).join('; '));
                }
                if (chronologyReview.draftId && changes[chronologyReview.draftId]) setEpisodeDate(changes[chronologyReview.draftId]);
                setChronologyReview(null);
            };
            const [logs, setLogs] = useState([]);
            const logsRef = useRef([]);
            useEffect(() => { logsRef.current = logs; }, [logs]);
            const [settings, setSettings] = useState({
                ranks: DEFAULT_RANKS, units: DEFAULT_UNITS, sectors: DEFAULT_SECTORS, causes: DEFAULT_CAUSES
            });

            useEffect(() => {
                const loadData = async () => {
                    try {
                        let [savedSoldiers, savedEpisodes, savedLogs, savedSettings] = await Promise.all([
                            localforage.getItem('med_soldiers_v3'),
                            localforage.getItem('med_episodes_v3'),
                            localforage.getItem('med_logs_v3'),
                            localforage.getItem('med_settings_v3')
                        ]);
                        const hasLfRecords = savedSoldiers !== null && savedEpisodes !== null;
                        const hasLfLogs = savedLogs !== null;
                        if (!savedSoldiers) {
                            const ls = localStorage.getItem('med_soldiers_v3') || localStorage.getItem('med_soldiers_v2');
                            savedSoldiers = ls ? JSON.parse(ls) : [];
                        }
                        if (!savedEpisodes) {
                            const ls = localStorage.getItem('med_episodes_v3') || localStorage.getItem('med_episodes_v2');
                            savedEpisodes = ls ? JSON.parse(ls) : [];
                        }
                        if (!savedLogs) {
                            const ls = localStorage.getItem('med_logs_v3') || localStorage.getItem('med_logs_v2');
                            savedLogs = ls ? JSON.parse(ls) : [{ id: 'init', timestamp: new Date().toISOString(), action: 'Система', details: 'База створена' }];
                        }
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
                        if (hasLfRecords && !window.SuiteRuntime?.restoring) {
                            clearLegacyMedLocalStorage({ includeLogs: hasLfLogs });
                        }
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
            const [clockTick, setClockTick] = useState(0);
            useEffect(() => {
                if (!['list', 'awol', 'triage'].includes(activeTab)) return;
                const timer = setInterval(() => setClockTick(tick => tick + 1), 60000);
                return () => clearInterval(timer);
            }, [activeTab]);
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
            const [groupAnalytics, setGroupAnalytics] = useState(false);
            const lastActiveElementRef = useRef(null);
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

            const [feedCutoffEnabled, setFeedCutoffEnabled] = useState(() => {
                const saved = localStorage.getItem('med_feed_cutoff_enabled');
                return saved !== null ? saved === 'true' : true;
            });
            const [feedCutoffDate, setFeedCutoffDate] = useState(() => {
                return localStorage.getItem('med_feed_cutoff_date') || '2026-11-11';
            });
            const [showOlderArchive, setShowOlderArchive] = useState(false);

            const handleToggleFeedCutoff = (checked) => {
                setFeedCutoffEnabled(checked);
                window.SuiteRuntime.setLocalItem('med_feed_cutoff_enabled', String(checked));
            };

            const handleChangeFeedCutoffDate = (val) => {
                setFeedCutoffDate(val);
                window.SuiteRuntime.setLocalItem('med_feed_cutoff_date', val);
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

            const [isAddWoundedOpen, setIsAddWoundedOpen] = useState(false);
            const [isBackupOpen, setIsBackupOpen] = useState(false);
            const [isEditOpen, setIsEditOpen] = useState(false);
            const [isClearDbConfirmOpen, setIsClearDbConfirmOpen] = useState(false);
            const [clearKeepAwol, setClearKeepAwol] = useState(false);
            const [clearKeepUnevac200, setClearKeepUnevac200] = useState(false);
            const [clearKeepEpisodeIds, setClearKeepEpisodeIds] = useState([]);
            const [clearSearchTerm, setClearSearchTerm] = useState("");
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
                show200: true, show200pvr: true, showWound: true, showCombatTr: true, 
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

            const SEVERITY_COLORS = {
                'Легкий': '#10b981',
                'Середній': '#f59e0b',
                'Важкий': '#ef4444',
                'Критичний': '#a855f7',
                'Дані відсутні': '#6b7280'
            };

            const triggerNotification = useCallback((text, type = "success") => {
                setNotification({ text, type });
                setTimeout(() => setNotification(null), 4000);
            }, []);

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

            const hasOpenModal = isAddWoundedOpen || isEditOpen || 
                                 isBackupOpen || isClearDbConfirmOpen || showAutoRestoreModal || !!chronologyReview || !!personMatches;

            // Нативне блокування фонового скролу та відновлення фокусу (a11y)
            useEffect(() => {
                if (hasOpenModal) {
                    if (!lastActiveElementRef.current && document.activeElement) {
                        lastActiveElementRef.current = document.activeElement;
                    }
                    document.body.classList.add('modal-open');
                } else {
                    document.body.classList.remove('modal-open');
                    if (lastActiveElementRef.current && typeof lastActiveElementRef.current.focus === 'function') {
                        lastActiveElementRef.current.focus();
                        lastActiveElementRef.current = null;
                    }
                }
                return () => {
                    document.body.classList.remove('modal-open');
                };
            }, [hasOpenModal]);

            // Плавне перемикання вкладок за допомогою View Transitions API
            const handleTabSwitch = useCallback((tab) => {
                if (tab === activeTab) return;
                if (document.startViewTransition) {
                    document.startViewTransition(() => {
                        startTransition(() => setActiveTab(tab));
                    });
                } else {
                    startTransition(() => setActiveTab(tab));
                }
            }, [activeTab]);

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
            }, [undoAction, openDropdown, isClearDbConfirmOpen, isBackupOpen, isAddWoundedOpen, isEditOpen]);

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
                    map.set(ep.soldierId, pickMedicalEpisode(existing, ep));
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
                    map.set(ep.soldierId, pickMedicalEpisode(existing, ep));
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
                const awolCount = latestEpisodesData.filter(e => isAwol(e.lossType) && !isAwolReturnEp(e)).length;
                const awolTotal = latestEpisodesData.filter(e => isAwol(e.lossType)).length;
                const awolReturned = latestEpisodesData.filter(e => isAwolReturnEp(e)).length;
                const lossesCount = timeFilteredEpisodes.filter(e => !isAwol(e.lossType)).length;
                const awolFilteredCount = timeFilteredEpisodes.filter(e => isAwol(e.lossType)).length;
                const lossesSoldiersCount = latestEpisodesData.filter(e => !isAwol(e.lossType)).length;
                const count300 = latestEpisodesData.filter(e => isAny300(e.lossType)).length;
                
                return { totalEpisodes, uniqueSoldiersCount, activeEvacNeed300, activeEvacNeed200_MIA, deadCount, miaCount, awolCount, awolTotal, awolReturned, lossesCount, awolFilteredCount, lossesSoldiersCount, count300 };
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

                    if (!isLossTypeActive(ep.lossType, dynFilters, groupAnalytics)) return;

                    const effType = groupAnalytics ? (ep.lossType === 'Зниклий безвісти (ЗБВ)' ? 'Загибель (200)' : ep.lossType === 'Бойове травмування (300)' ? 'Поранення (300)' : ep.lossType) : (ep.lossType === 'Бойове травмування (300)' ? 'Поранення (300)' : ep.lossType);
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
                    if (!isLossTypeActive(e.lossType, dynFilters, groupAnalytics)) return false;
                    if (e.evacStatus !== "Не евакуйований" || !isAny300(e.lossType)) return false;
                    if (anUdp !== "all" && ((anUdp === "yes" && !e.inUdp) || (anUdp === "no" && e.inUdp))) return false;
                    if (anSector !== "all" && e.actualLoc !== anSector && e.docLoc !== anSector) return false;
                    return true;
                }).length;

                const globalWaitingCritHeavy = globalLatestEpisodes.filter(e => {
                    if (!isLossTypeActive(e.lossType, dynFilters, groupAnalytics)) return false;
                    if (e.evacStatus !== "Не евакуйований" || !isAny300(e.lossType)) return false;
                    if (e.severity !== 'Критичний' && e.severity !== 'Важкий') return false;
                    if (anUdp !== "all" && ((anUdp === "yes" && !e.inUdp) || (anUdp === "no" && e.inUdp))) return false;
                    if (anSector !== "all" && e.actualLoc !== anSector && e.docLoc !== anSector) return false;
                    return true;
                }).length;

                const globalWaiting200 = globalLatestEpisodes.filter(e => {
                    if (!isLossTypeActive(e.lossType, dynFilters, groupAnalytics)) return false;
                    const effType = groupAnalytics ? (e.lossType === 'Зниклий безвісти (ЗБВ)' ? 'Загибель (200)' : e.lossType) : e.lossType;
                    if (e.evacStatus !== "Не евакуйований" || !isAny200(effType)) return false;
                    if (anUdp !== "all" && ((anUdp === "yes" && !e.inUdp) || (anUdp === "no" && e.inUdp))) return false;
                    if (anSector !== "all" && e.actualLoc !== anSector && e.docLoc !== anSector) return false;
                    return true;
                }).length;

                const globalWaitingMia = globalLatestEpisodes.filter(e => {
                    if (!isLossTypeActive(e.lossType, dynFilters, groupAnalytics)) return false;
                    if (groupAnalytics) return false;
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
            }, [episodes, globalLatestEpisodes, anDateFrom, anDateTo, anUdp, anSector, anShowLatest, groupAnalytics, dynFilters]);

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
                    if (!isLossTypeActive(ep.lossType, dynFilters, groupAnalytics)) return false;
                    return true;
                });
                if (anShowLatest) {
                    const map = new Map();
                    filtered.forEach(ep => map.set(ep.soldierId, pickMedicalEpisode(map.get(ep.soldierId), ep)));
                    filtered = Array.from(map.values()).sort((a, b) => parseSafeDate(b.date) - parseSafeDate(a.date));
                }
                return filtered;
            }, [episodes, anDateFrom, anDateTo, anUdp, anSector, anShowLatest, dynFilters, groupAnalytics]);

            const chartData = useMemo(() => {
                const anFiltered = anFilteredEpisodes;

                // Ініціалізація карти часу (24 години)
                const timeMap = {};
                for (let i = 0; i < 24; i++) {
                    const hr = i.toString().padStart(2, '0') + ":00";
                    timeMap[hr] = { '200': 0, '200 ПВР': 0, 'Неб. смерть': 0, 'Поранення': 0, 'Бойове': 0, 'Небойове': 0, 'ЗБВ': 0, 'СЗЧ': 0, 'Дезертирство': 0 };
                }
                
                let c200 = 0, c200nc = 0, c200pvr = 0, cWound = 0, cCombat = 0, cNonCombat = 0, cMia = 0, cAwol = 0, cDesert = 0;
                const dGroups = {};
                const rCounts = {};
                const uCounts = {};
                const sevCounts = {};
                const aLocCounts = {};
                const aLocSevCounts = {};
                const aLocCauseCounts = {}; 
                const activeCausesSet = new Set();
                
                const injuryStats = Object.fromEntries([...new Set(Object.values(INJURY_GROUPS))].map(label => [label, 0]));

                const evacDaysSum = { 'Критичний': 0, 'Важкий': 0, 'Середній': 0, 'Легкий': 0, '200 (Тіла)': 0 };
                const evacDaysCount = { 'Критичний': 0, 'Важкий': 0, 'Середній': 0, 'Легкий': 0, '200 (Тіла)': 0 };

                let evac200 = 0, evac300 = 0, notEvac200 = 0, notEvac300 = 0;

                anFiltered.forEach(d => {
                    let effType = d.lossType;
                    if (groupAnalytics) {
                        if (effType === 'Зниклий безвісти (ЗБВ)') effType = 'Загибель (200)';
                        if (effType === 'Бойове травмування (300)') effType = 'Поранення (300)';
                    }

                    const isEp200 = isAny200(effType) || effType === 'Зниклий безвісти (ЗБВ)';
                    const isEp300 = isAny300(effType);
                    
                    if (d.evacStatus === 'Евакуйований') {
                        if (isEp200) evac200++;
                        if (isEp300) evac300++;
                    } else if (d.evacStatus === 'Не евакуйований') {
                        if (isEp200) notEvac200++;
                        if (isEp300) notEvac300++;
                    }

                    const localDate = localMedicalInput(d.date);
                    const roundedHhMm = localDate ? roundTime(localDate.slice(11, 16)) : '';
                    const day = localDate.slice(0, 10) || 'Некоректна дата';
                    if (!dGroups[day]) dGroups[day] = { '200': 0, '200 ПВР': 0, 'Неб. смерть': 0, 'Поранення': 0, 'Бойове': 0, 'Небойове': 0, 'ЗБВ': 0, 'СЗЧ': 0, 'Дезертирство': 0 };

                    let typeKey = '';
                    if (effType === 'Загибель (200)') { typeKey = '200'; c200++; }
                    else if (effType === 'Небойова смерть (200)') { typeKey = 'Неб. смерть'; c200nc++; }
                    else if (effType === '200 (від ран)') { typeKey = '200 ПВР'; c200pvr++; }
                    else if (effType === 'Поранення (300)') { typeKey = 'Поранення'; cWound++; }
                    else if (effType === 'Бойове травмування (300)') { typeKey = 'Бойове'; cCombat++; }
                    else if (effType === 'Небойове травмування (300)') { typeKey = 'Небойове'; cNonCombat++; }
                    else if (effType === 'Зниклий безвісти (ЗБВ)') { typeKey = 'ЗБВ'; cMia++; }
                    else if (effType === 'СЗЧ' || effType === 'Повернення з СЗЧ') { typeKey = 'СЗЧ'; cAwol++; }
                    else if (effType === 'Дезертирство') { typeKey = 'Дезертирство'; cDesert++; }

                    if (typeKey) {
                        if (timeMap[roundedHhMm]) timeMap[roundedHhMm][typeKey]++;
                        dGroups[day][typeKey]++;
                    }

                    const soldier = MedicalPersonnelDirectory.forEpisode(d, soldiersMap.get(d.soldierId));
                    const unit = d.unit || (soldier && soldier.unit ? soldier.unit : 'Невідомо');
                    const causeStr = d.cause || 'Не вказано';
                    if (d.cause) activeCausesSet.add(d.cause);
                    
                    if (!uCounts[unit]) uCounts[unit] = { '200':0, '200 ПВР':0, 'Неб. смерть':0, 'Поранення':0, 'Бойове':0, 'Небойове':0, 'ЗБВ':0, 'СЗЧ':0, 'Дезертирство':0 };
                    if (typeKey) uCounts[unit][typeKey]++;

                    if (!rCounts[causeStr]) rCounts[causeStr] = { '200':0, '200 ПВР':0, 'Неб. смерть':0, 'Поранення':0, 'Бойове':0, 'Небойове':0, 'ЗБВ':0, 'СЗЧ':0, 'Дезертирство':0 };
                    if (typeKey) rCounts[causeStr][typeKey]++;

                    if (isAny300(d.lossType) && d.severity) sevCounts[d.severity] = (sevCounts[d.severity] || 0) + 1;
                    
                    const loc = d.actualLoc || 'Не вказано';
                    
                    if (!aLocCounts[loc]) aLocCounts[loc] = { '200':0, '200 ПВР':0, 'Неб. смерть':0, 'Поранення':0, 'Бойове':0, 'Небойове':0, 'ЗБВ':0, 'СЗЧ':0, 'Дезертирство':0 };
                    if (typeKey) aLocCounts[loc][typeKey]++;

                    if (isAny300(d.lossType) && d.severity) {
                        if (!aLocSevCounts[loc]) aLocSevCounts[loc] = { 'Легкий':0, 'Середній':0, 'Важкий':0, 'Критичний':0 };
                        aLocSevCounts[loc][d.severity]++;
                    }

                    if (!aLocCauseCounts[loc]) aLocCauseCounts[loc] = {};
                    if (!aLocCauseCounts[loc][causeStr]) aLocCauseCounts[loc][causeStr] = 0;
                    aLocCauseCounts[loc][causeStr]++;

                    if (d.injuries) {
                        injuryGroups(d.injuries).forEach(label => { injuryStats[label] = (injuryStats[label] || 0) + 1; });
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

                const activeDates = Object.keys(dGroups).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)).sort();
                if (activeDates.length > 0) {
                    // Визначаємо початок і кінець в мілісекундах (в UTC для уникнення зсувів часового поясу)
                    const startMs = new Date(activeDates[0] + "T00:00:00Z").getTime();
                    const endMs = new Date(activeDates[activeDates.length - 1] + "T00:00:00Z").getTime();
                    
                    // Крокуємо по 24 години (86400000 мс)
                    for (let t = startMs; t <= endMs; t += 86400000) {
                        const dateStr = new Date(t).toISOString().split('T')[0];
                        // Якщо дати немає в масиві, створюємо її з нульовими показниками
                        if (!dGroups[dateStr]) {
                            dGroups[dateStr] = { '200': 0, '200 ПВР': 0, 'Неб. смерть': 0, 'Поранення': 0, 'Бойове': 0, 'Небойове': 0, 'ЗБВ': 0, 'СЗЧ': 0, 'Дезертирство': 0 };
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

                const showAny300 = dynFilters.showWound || dynFilters.showCombatTr || dynFilters.showNonCombatTr;
                const showAny200 = dynFilters.show200 || dynFilters.show200pvr || dynFilters.showNonCombatDead;

                const evacLabels = [
                    ...(showAny300 ? ['Критичний', 'Важкий', 'Середній', 'Легкий'] : []),
                    ...(showAny200 ? ['200 (Тіла)'] : [])
                ];
                const evacColorsMap = {
                    'Критичний': '#a855f7',
                    'Важкий': '#ef4444',
                    'Середній': '#f59e0b',
                    'Легкий': '#10b981',
                    '200 (Тіла)': '#71717a'
                };
                const evacChartDataConfig = {
                    labels: evacLabels,
                    datasets: [{
                        label: 'Середній час (днів)',
                        data: evacLabels.map(l => evacDaysCount[l] > 0 ? (evacDaysSum[l] / evacDaysCount[l]).toFixed(1) : 0),
                        backgroundColor: evacLabels.map(l => evacColorsMap[l]),
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
                    types: { c200, c200nc, c200pvr, cWound, cCombat, cNonCombat, cMia, cAwol, cDesert },
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
            }, [anFilteredEpisodes, soldiersMap, groupAnalytics, dynFilters, settings.causes]);

            const soldierHistory = useMemo(() => {
                if (!selectedSoldierId) return [];
                return episodes
                    .filter(ep => ep.soldierId === selectedSoldierId && (!currentEpisode || ep.id !== currentEpisode.id))
                    .sort((a, b) => parseSafeDate(b.date) - parseSafeDate(a.date));
            }, [selectedSoldierId, currentEpisode, episodes]);

            
            const handleCopyFilteredList = () => {
                const targetList = mainFilteredList.length > 0 ? mainFilteredList : filteredList;
                if (targetList.length === 0) return;
                const lines = targetList.map((ep, idx) => {
                    const sol = MedicalPersonnelDirectory.forEpisode(ep, soldiersMap.get(ep.soldierId));
                    const waitStr = calculateWaitTimeUI(ep.date);
                    const epWithWait = { ...ep, waitStr: waitStr !== 'Невідомо' ? waitStr : '' };
                    return formatSoldierReportLine(epWithWait, sol, idx + 1);
                });
                const fullText = lines.join('\n');
                
                const onDone = () => {
                    setIsListCopied(true);
                    setTimeout(() => setIsListCopied(false), 2500);
                    triggerNotification(`Скопійовано ${targetList.length} записів для доповіді!`, "success");
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
                        clearLegacyMedLocalStorage();
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
                        const dInfo = localMedicalInput(ep.date).slice(0, 10) || 'без коректної дати';
                        const tInfo = ep.lossType || 'тип не вказано';
                        issues.push({
                            id: ep.id,
                            episode: ep,
                            text: `Епізод #${(ep.id || '').slice(0, 6)} (${sInfo}, ${dInfo}, ${tInfo}): запис втрати не прив\u0027язаний до реєстру бійців`
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
                        triggerNotification('База повністю здорова: 100% цілісності.', 'success');
                    } else {
                        triggerNotification(`Знайдено ${issues.length} зауважень. Натисніть "Полікувати базу".`, 'warning');
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

                    let count200 = 0, count200PVR = 0, count300 = 0, countMIA = 0, countAWOL = 0;
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
                        const isNotEvac = ep.evacStatus === 'Не евакуйований';

                        if (isDead) {
                            count200++;
                            if (ep.lossType === '200 (від ран)') count200PVR++;
                            if (isEvac) evac200++;
                            else if (isNotEvac) notEvac200++;
                        } else if (isWounded) {
                            count300++;
                            const s = ep.severity || 'Невідомо';
                            sevMap[s] = (sevMap[s] || 0) + 1;
                            if (isEvac) evac300++;
                            else if (isNotEvac) notEvac300++;
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
                            <tr ${rowBg} class="reg-row" data-evac="${evacVal}" data-dead="${isDead ? '1':'0'}" data-wound="${isWounded ? '1':'0'}" data-sev="${ep.severity || ''}" data-mia="${isMia ? '1':'0'}" data-awol="${isAw ? '1':'0'}" data-cause="${causeClean}" data-unit="${unitClean}">
                                <td class="row-num" style="text-align:center; font-family:'JetBrains Mono',monospace; font-size:8pt;">${idx + 1}</td>
                                <td style="font-family:'JetBrains Mono',monospace; font-size:8pt; white-space:nowrap;">${localMedicalInput(ep.date).replace('T', ' ') || 'Некоректна дата'}</td>
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
                <label class="check-toggle" style="margin-left: 10px; color:#f472b6;"><input type="checkbox" id="chk-show-awol" checked onchange="toggleShowAwol(this.checked)"> Показувати СЗЧ/Дезерт.</label>
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
                    <div class="sub" style="display:flex; justify-content:space-between;">
                        <span>Безповоротні</span>
                        <span style="color:#64748b;">(з них ПВР: <b style="color:#475569;">${count200PVR}</b>)</span>
                    </div>
                </div>
                <div class="summary-card">
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
                <div class="summary-card">
                    <div class="label" style="color: #16a34a;">Евакуйовано (з актуальних)</div>
                    <div class="value" style="color: #16a34a;">${evac300 + evac200}</div>
                    <div style="display:flex; justify-content:space-between; font-weight:600; font-size:8pt; color:#334155; margin-top:4px; padding-top:3px; border-top:1px solid #e2e8f0;">
                        <span>300-х: <b>${evac300}</b></span>
                        <span>200-х: <b>${evac200}</b></span>
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
                        <div style="font-size:7.5pt; color:#64748b;">${groupAnalytics ? 'тіл та ЗБВ' : 'тіл на позиціях'}</div>
                    </div>
                    ${!groupAnalytics && countMIA > 0 ? `
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
                    win.showAwol = true;

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
                    win.toggleShowAwol = function(show) {
                        win.showAwol = show;
                        win.applyFilters();
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
                            var isAwol = r.getAttribute('data-awol') === '1';
                            var sev = r.getAttribute('data-sev');
                            var cause = r.getAttribute('data-cause') || '—';
                            var unit = r.getAttribute('data-unit') || '—';

                            var matchEvac = (win.curEvac === 'all') || (win.curEvac === 'not_evac' && ev === 'not_evac') || (win.curEvac === 'evac' && ev === 'evac');
                            var matchType = (win.curType === 'all') || (win.curType === '200' && isDead) || (win.curType === '300' && isWound) || (win.curType === '300_heavy' && isWound && (sev === 'Критичний' || sev === 'Важкий')) || (win.curType === 'mia' && isMia);
                            
                            if (isAwol && !win.showAwol) {
                                matchType = false;
                            }

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
                            ? causeEntries.map(function(pair) { return '<tr><td>' + pair[0] + '</td><td style="text-align:right; font-weight:bold; font-family:JetBrains Mono, monospace;">' + pair[1] + '</td></tr>'; }).join('')
                            : '<tr><td colspan="2" style="text-align:center; color:#94a3b8;">Дані відсутні</td></tr>';
                        var tbCauses = doc.getElementById('tbody-causes'); if (tbCauses) tbCauses.innerHTML = causeHtml;

                        var unitEntries = Object.entries(unitCounts).sort(function(a, b) { return b[1] - a[1]; });
                        var unitHtml = unitEntries.length > 0
                            ? unitEntries.map(function(pair) { return '<tr><td>' + pair[0] + '</td><td style="text-align:right; font-weight:bold; font-family:JetBrains Mono, monospace;">' + pair[1] + '</td></tr>'; }).join('')
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
                    const effType = groupAnalytics ? (ep.lossType === 'Зниклий безвісти (ЗБВ)' ? 'Загибель (200)' : ep.lossType === 'Бойове травмування (300)' ? 'Поранення (300)' : ep.lossType) : ep.lossType;
                    
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

                    const effType = groupAnalytics ? (ep.lossType === 'Зниклий безвісти (ЗБВ)' ? 'Загибель (200)' : ep.lossType === 'Бойове травмування (300)' ? 'Поранення (300)' : ep.lossType) : (ep.lossType === 'Бойове травмування (300)' ? 'Поранення (300)' : ep.lossType);
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
                
                if (!groupAnalytics) {
                    report += `\nЗниклі безвісти – ${miaEps.length}${getCallsigns(miaEps)}\n\n`;
                } else {
                    report += `\n`;
                }
                
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
                if (!groupAnalytics && globalNotEvacMiaEps.length > 0) {
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
                try {
                    const workbook = createMedicalWorkbook(ExcelJS, {
                        episodes: anFilteredEpisodes,
                        allEpisodes: episodes,
                        selection: { dateFrom: anDateFrom, dateTo: anDateTo, udp: anUdp, sector: anSector, showLatest: anShowLatest },
                        personFor: ep => MedicalPersonnelDirectory.forEpisode(ep, soldiersMap.get(ep.soldierId)),
                        regions: BODY_REGIONS,
                        filters: 'Період: ' + (anDateFrom || 'початок') + ' — ' + (anDateTo || 'кінець') + '; УПД: ' + anUdp + '; місце: ' + anSector + '; лише останній стан: ' + (anShowLatest ? 'так' : 'ні')
                    });
                    const buffer = await workbook.xlsx.writeBuffer();
                    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
                    const link = document.createElement('a'); link.href = url;
                    link.download = 'Analytics_Report_' + window.SuiteDates.localISO() + '.xlsx';
                    document.body.appendChild(link); link.click(); link.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 30000);
                } catch (error) { triggerNotification('Не вдалося сформувати Excel: ' + error.message, 'error'); }
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
                        if (activeTab !== "list" && activeTab !== "awol" && activeTab !== "triage") {
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

                    // Розділення списків: вкладка 'list' (Втрати о/с) показує 300, 200, ЗБВ; вкладка 'awol' (Облік СЗЧ) показує СЗЧ/Дезертирство
                    if (activeTab === 'awol') {
                        if (!isAwol(episode.lossType)) return false;
                    } else if (activeTab === 'list') {
                        if (isAwol(episode.lossType)) return false;
                    }

                    let matchSearch = true;
                    if (normSearch) {
                        const searchStr = normalizeMilitaryText(`${soldier.name} ${soldier.callsign || ''} ${episode.unit || soldier.unit || ''} ${episode.actualLoc || ''} ${episode.docLoc || ''} ${episode.cause || ''}`, { toLower: true, replaceHomoglyphs: true });
                        matchSearch = searchStr.includes(normSearch);
                    }

                    const effectiveLossType = (episode.lossType === "СЗЧ" && episode.awolStatus === "Повернувся") ? "Повернення з СЗЧ" : episode.lossType;
                    const matchLoss = filterLossTypes.includes(effectiveLossType);
                    const matchSeverity = isAny300(episode.lossType) ? (!episode.severity || filterSeverities.includes(episode.severity)) : true;
                    const currentStatus = isAwol(episode.lossType) ? (isAwolReturnEp(episode) ? "Повернувся" : (episode.awolStatus || "В розшуку")) : episode.evacStatus;
                    const matchEvac = filterEvacStatuses.includes(currentStatus);
                    const matchCause = isAwol(episode.lossType) ? true : (!episode.cause || filterCauses.includes(episode.cause));
                    const matchUdp = filterUdp === "all" ? true : (filterUdp === "yes" ? episode.inUdp : !episode.inUdp);
                    
                    const matchWeapon = filterWeapon.length === 0 || filterWeapon.includes(episode.weaponStatus || "Не вказано");
                    const matchReport = filterReport === "all" ? true : (filterReport === "yes" ? episode.hasReport : !episode.hasReport);
                    const matchInjury = filterInjuries.length === 0 || (
                        isAny300(episode.lossType) && filterInjuries.some(injKey => 
                            episode.injuries && Object.values(episode.injuries).some(region => region && (region[injKey] || (injKey === 'amputation' && (region.amp_hand || region.amp_foot || region.amp_fingers))))
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
            }, [activeDataSource, soldiersMap, searchTerm, filterLossTypes, filterSeverities, filterEvacStatuses, filterCauses, filterUdp, filterWeapon, filterReport, filterInjuries, sortBy, activeTab]);

            const isFeedCutoffActive = activeTab === "list" && feedCutoffEnabled && Boolean(feedCutoffDate) && !searchTerm.trim();

            const { mainFilteredList, olderArchiveList } = useMemo(() => {
                if (!isFeedCutoffActive) {
                    return { mainFilteredList: filteredList, olderArchiveList: [] };
                }
                const cutoffMs = parseSafeDate(`${feedCutoffDate} 00:00:00`);
                if (!cutoffMs) {
                    return { mainFilteredList: filteredList, olderArchiveList: [] };
                }
                const recent = [];
                const older = [];
                for (let i = 0; i < filteredList.length; i++) {
                    const ep = filteredList[i];
                    if (parseSafeDate(ep.date) >= cutoffMs) {
                        recent.push(ep);
                    } else {
                        older.push(ep);
                    }
                }
                return { mainFilteredList: recent, olderArchiveList: older };
            }, [filteredList, isFeedCutoffActive, feedCutoffDate]);

            // Видима порція списку карток (для максимальної швидкодії)
            const visibleList = useMemo(() => {
                return mainFilteredList.slice(0, displayLimit);
            }, [mainFilteredList, displayLimit]);

            // При зміні будь-яких фільтрів або сортування автоматично повертаємо ліміт до 50
            useEffect(() => {
                setDisplayLimit(50);
            }, [searchTerm, filterLossTypes, filterSeverities, filterEvacStatuses, filterCauses, filterUdp, filterWeapon, filterReport, filterInjuries, listDateFrom, listDateTo, datePreset, showOnlyLatest, sortBy, feedCutoffEnabled, feedCutoffDate]);

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
                
                const isReturnedTabView = activeTab === 'awol' && filterEvacStatuses.includes('Повернувся') && !filterEvacStatuses.includes('В розшуку');
                setEpisodeDate("");
                setLossType(activeTab === 'awol' ? (isReturnedTabView ? "Повернення з СЗЧ" : "СЗЧ") : "");
                setCause("");
                setSeverity("");
                setInUdp(false);
                setActualLoc("");
                setDocLoc("");
                setNotes("");
                setInjuries({});
                setEvacStatus("Не евакуйований");
                setAwolStatus(isReturnedTabView ? "Повернувся" : "В розшуку");
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

            const hasAnyInjury = (regionId) => Object.values(injuries?.[regionId] || {}).some(Boolean);

            const handleSaveWounded = (e) => {
                e.preventDefault();
                
                if(!episodeDate) return triggerNotification("Вкажіть точну дату та час події", "error");
                if(!lossType) return triggerNotification("Оберіть тип події", "error");
                if(!cause) return triggerNotification("Оберіть причину", "error");
                if(isAny300(lossType) && !severity) return triggerNotification("Оберіть важкість", "error");

                let finalSoldierId = selectedSoldierId;
                if (rosterCandidates.length) return triggerNotification('Уточніть відповідність старій медичній картці або підтвердьте, що це інша особа.', 'error');

                if (!parseSafeDate(episodeDate)) return triggerNotification('Некоректна дата події.', 'error');
                const finalAwolStatus = lossType === "Повернення з СЗЧ" ? "Повернувся" : awolStatus;
                const eventDatePart = localMedicalInput(episodeDate).slice(0, 10);
                if ((evacStatus === 'Евакуйований' || finalAwolStatus === 'Повернувся') && evacDate && eventDatePart && evacDate < eventDatePart) {
                    return triggerNotification("Дата евакуації / повернення не може бути раніше дати події", "error");
                }
                if (!finalSoldierId && !forceNewPerson) {
                    const candidates = personCandidates({ name: newSoldierName, callsign: newSoldierCallsign, unit: newSoldierUnit }, soldiers, personnelDirectory.entries);
                    if (candidates.length) { setPersonMatches(candidates); return; }
                }
                if (!checkChronology({ id: '__draft', soldierId: finalSoldierId || '__new', date: episodeDate, lossType })) return;
                if (!newSoldierName.trim() || !newSoldierUnit) return triggerNotification('ПІБ та Підрозділ є обов’язковими.', 'error');
                saveHistory();

                if (!finalSoldierId) {
                    if (!newSoldierName.trim() || !newSoldierUnit) {
                        return triggerNotification("ПІБ та Підрозділ є обов\u0027язковими (Позивний та Звання — за бажанням)", "error");
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
                    id: 'ep_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                    soldierId: finalSoldierId, date: episodeDate, lossType, cause,
                    ...(rosterSelection ? { personnelSnapshot: { name: newSoldierName.trim(), callsign: formatCallsignUI(newSoldierCallsign), rank: newSoldierRank, unit: newSoldierUnit, sourceRosterId: rosterSelection.rosterId } } : {}),
                    severity: is300 ? severity : null,
                    rank: newSoldierRank || soldierObj.rank || "Не вказано",
                    unit: newSoldierUnit || soldierObj.unit || "Не вказано",
                    inUdp, actualLoc, docLoc,
                    injuries: is300 ? injuries : {},
                    notes, evacStatus, awolStatus: finalAwolStatus, weaponStatus,
                    evacTime: (evacStatus === 'Евакуйований' || finalAwolStatus === 'Повернувся') ? (evacDate || todayStrDate) : "",
                    hasReport, reportDate: hasReport ? (reportDate || todayStrDate) : ""
                };

                setEpisodes(prev => [newEpisode, ...prev]);
                const soldierDisplayName = soldierObj.callsign ? `«${soldierObj.callsign}»` : (soldierObj.name || newSoldierName);
                addLog("Нова подія", `Зафіксовано ${lossType} у в/сл ${soldierDisplayName}. Причина: ${cause}.`);
                
                setIsAddWoundedOpen(false);
                triggerNotification("Запис успішно додано");
            };

            const handleStartEdit = useCallback((episode) => {
                const soldier = MedicalPersonnelDirectory.forEpisode(episode, soldiersMap.get(episode.soldierId));
                setRosterSelection(null); setRosterCandidates([]); setForceNewPerson(false);
                setCurrentEpisode(episode);
                setSelectedSoldierId(episode.soldierId);
                setSoldierSearch(soldier ? `${soldier.name} «${soldier.callsign}»` : "");
                setSearchMatches([]);
                setNewSoldierName(soldier?.name || "");
                setNewSoldierCallsign(soldier?.callsign || "");
                setNewSoldierRank(episode.rank || soldier?.rank || "");
                setNewSoldierUnit(episode.unit || soldier?.unit || "");
                setEpisodeDate(localMedicalInput(episode.date));
                setLossType((episode.lossType === "СЗЧ" && episode.awolStatus === "Повернувся") ? "Повернення з СЗЧ" : (episode.lossType || ""));
                setCause(episode.cause || "");
                setSeverity(episode.severity || "");
                setInUdp(episode.inUdp);
                setActualLoc(episode.actualLoc || "");
                setDocLoc(episode.docLoc || "");
                setNotes(episode.notes || "");
                setInjuries(episode.injuries || {});
                setEvacStatus(episode.evacStatus || "Не евакуйований");
                setAwolStatus(isAwolReturnEp(episode) ? "Повернувся" : (episode.awolStatus || "В розшуку"));
                
                const evT = localMedicalInput(episode.evacTime).slice(0, 10);
                setEvacDate(evT);
                
                setHasReport(episode.hasReport || false);
                setReportDate(episode.reportDate || "");
                setWeaponStatus(episode.weaponStatus || "");
                setConfirmDelete(false);
                setIsEditOpen(true);
            }, [soldiersMap]);

            useEffect(() => {
                const openReviewed = ({ detail }) => {
                    if (detail?.module !== 'med' || detail.kind || !detail.recordId) return;
                    const matches = episodes.filter(row => String(row.id) === detail.recordId);
                    if (matches.length === 1) handleStartEdit(matches[0]);
                    else triggerNotification('Неможливо однозначно відкрити епізод за ID. Перевірте журнал.', 'error');
                };
                window.addEventListener('suite-review-record', openReviewed);
                return () => window.removeEventListener('suite-review-record', openReviewed);
            }, [episodes, soldiers]);

            useEffect(() => {
                const handleScroll = () => {
                    const btn = document.getElementById('btn-scroll-top');
                    if (!btn) return;
                    const container = document.querySelector('[data-suite-module="med"]');
                    const scrollTop = (container && container.scrollTop) || window.scrollY || 0;
                    if (scrollTop > 300) {
                        btn.classList.add('visible');
                    } else {
                        btn.classList.remove('visible');
                    }
                };
                const container = document.querySelector('[data-suite-module="med"]');
                window.addEventListener('scroll', handleScroll, { passive: true });
                if (container) {
                    container.addEventListener('scroll', handleScroll, { passive: true });
                }
                return () => {
                    window.removeEventListener('scroll', handleScroll);
                    if (container) {
                        container.removeEventListener('scroll', handleScroll);
                    }
                };
            }, []);

            const handleUpdateWounded = (e) => {
                e.preventDefault();
                if (!currentEpisode) return;

                if(!episodeDate) return triggerNotification("Вкажіть точну дату та час події", "error");
                if(!lossType) return triggerNotification("Оберіть тип події", "error");
                if(!cause) return triggerNotification("Оберіть причину", "error");
                if(isAny300(lossType) && !severity) return triggerNotification("Оберіть важкість", "error");
                if (!newSoldierUnit || !newSoldierName.trim()) return triggerNotification("ПІБ та Підрозділ є обов\u0027язковими", "error");

                if (!parseSafeDate(episodeDate)) return triggerNotification('Некоректна дата події.', 'error');
                const finalAwolStatus = lossType === "Повернення з СЗЧ" ? "Повернувся" : awolStatus;
                const eventDatePart = localMedicalInput(episodeDate).slice(0, 10);
                if ((evacStatus === 'Евакуйований' || finalAwolStatus === 'Повернувся') && evacDate && eventDatePart && evacDate < eventDatePart) {
                    return triggerNotification("Дата евакуації / повернення не може бути раніше дати події", "error");
                }
                if (!checkChronology({ ...currentEpisode, date: episodeDate, lossType })) return;
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
                    notes, evacStatus, awolStatus: finalAwolStatus, weaponStatus,
                    evacTime: (evacStatus === 'Евакуйований' || finalAwolStatus === 'Повернувся') ? (evacDate || todayStrDate) : "",
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

            const handleClearDatabase = async () => {
                await createSafetySnapshot('Знімок перед очищенням бази');
                saveHistory();
                const keepIds = new Set(clearKeepEpisodeIds);
                const keptEpisodes = episodes.filter(ep =>
                    (clearKeepAwol && isAwol(ep.lossType)) ||
                    (clearKeepUnevac200 && isAny200(ep.lossType) && ep.evacStatus === "Не евакуйований") ||
                    keepIds.has(ep.id)
                );
                if (keptEpisodes.length === 0) {
                    setSoldiers([]); setEpisodes([]);
                    setLogs([{ id: 'init', timestamp: new Date().toISOString(), action: 'Система', details: 'Базу повністю очищено користувачем' }]);
                    triggerNotification("Базу успішно очищено!", "success");
                } else {
                    const keptSoldierIds = new Set(keptEpisodes.map(ep => ep.soldierId).filter(Boolean));
                    const keptSoldiers = soldiers.filter(s => keptSoldierIds.has(s.id));
                    const removedEpCount = episodes.length - keptEpisodes.length;
                    setSoldiers(keptSoldiers);
                    setEpisodes(keptEpisodes);
                    addLog("Очищення бази", `Вибіркове очищення: видалено ${removedEpCount} епізодів, залишено ${keptEpisodes.length} епізодів (${keptSoldiers.length} бійців)`);
                    triggerNotification(`Вибіркове очищення виконано! Залишено епізодів: ${keptEpisodes.length}`, "success");
                }
                clearLegacyMedLocalStorage();
                setIsClearDbConfirmOpen(false); setIsBackupOpen(false);
            };

            const handleExport = () => {
                if (!backupPassword) return triggerNotification("Введіть пароль!", "error");
                try {
                    const rawJson = JSON.stringify({ soldiers, episodes, logs, settings });
                    const encrypted = CryptoJS.AES.encrypt(rawJson, backupPassword).toString();
                    const link = document.createElement('a');
                    link.download = `med_backup_${window.SuiteDates.localISO()}.enc`;
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
                            clearLegacyMedLocalStorage();
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
                        clearLegacyMedLocalStorage();

                        setSessionPassword(pwd);
                        setBackupPassword(pwd);
                        setDiskRestorePassword("");
                        setShowAutoRestoreModal(false);
                        setIsBackupOpen(false);
                        addLog("Відновлення", `Базу відновлено з диска (${parsed.soldiers.length} о/с, ${cleanedImportEpisodes.length} епізодів)`);
                        triggerNotification(`Відновлено: ${parsed.soldiers.length} бійців, ${cleanedImportEpisodes.length} епізодів.`, "success");
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
                        triggerNotification("Базу надійно збережено на локальний диск.", "success");
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

            const createDeadFromWoundsRecord = (ep) => {
                saveHistory();
                
                const now = new Date();
                const pad = (n) => n.toString().padStart(2, '0');
                const isoStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
                
                const newEpisode = {
                    ...ep,
                    id: 'ep_' + Date.now() + Math.floor(Math.random() * 1000),
                    date: isoStr,
                    lossType: '200 (від ран)',
                    severity: null,
                    injuries: {},
                    evacStatus: 'Не евакуйований',
                    evacTime: "",
                    hasReport: false,
                    reportDate: "",
                };
                
                setEpisodes(prev => [newEpisode, ...prev]);
                
                const soldier = soldiersMap.get(ep.soldierId);
                const soldierDisplayName = soldier?.callsign ? `«${soldier.callsign}»` : (soldier?.name || 'Невідомий');
                addLog("Нова подія", `Створено запис 200 (від ран) для ${soldierDisplayName}. Причина: ${ep.cause || 'Не вказано'}.`);
                triggerNotification("Запис 200 (від ран) додано, бійця переміщено в чорну зону.", "success");
            };

            const renderTriageCard = (ep) => (
                <TriageCard 
                    key={ep.id} 
                    ep={ep} 
                    soldier={soldiersMap.get(ep.soldierId)} 
                    soldierEpisodes={episodesBySoldier.get(ep.soldierId) || EMPTY_EPISODES}
                    onQuickEvac={quickEvacuate} 
                    onEdit={handleStartEdit} 
                    onAlertMIA={handleAlertMIA}
                    onCreate200FromWounds={createDeadFromWoundsRecord}
                    onReview={openChronology} clockTick={clockTick}
                />
            );

            const locChartHeight = Math.max(300, chartData.actLocs.labels.length * 28);

            if (isLoading) {
                return (
                    <div className="flex-1 flex items-center justify-center bg-[#101113] text-[#b8bec8]">
                        <div className="text-center space-y-3">
                            <Icon name="loader-2" className="w-8 h-8 animate-spin mx-auto text-[#4c8ed9]" />
                            <div className="font-mono text-xs uppercase font-semibold tracking-wider text-[#b8bec8]">Завантаження бази...</div>
                        </div>
                    </div>
                );
            }

            return (
                <div id="med-app" className="min-h-full min-w-0 flex flex-col p-3 sm:p-5 w-full space-y-4">
                    {personMatches && <PersonMatchDialog candidates={personMatches} onClose={() => setPersonMatches(null)} onChoose={person => { selectExistingSoldier(person); setPersonMatches(null); }} onSeparate={() => { setForceNewPerson(true); setPersonMatches(null); }} />}
                    {chronologyReview && <ChronologyDialog review={chronologyReview} onApply={applyChronology} onClose={() => setChronologyReview(null)} />}
                    {!!dateIssues.length && <div role="alert" className="bg-[#d9534f]/15 border border-[#d9534f]/50 text-[#f3a3a0] rounded-sm p-3 text-sm tabular-nums">
                        Виявлено {dateIssues.length} суперечностей дат. Статус загибелі не замінюється пізнішим пораненням.
                        <div className="flex flex-wrap gap-2 mt-2">{[...new Set(dateIssues.map(issue => issue.episode.soldierId))].map(id => <button key={id} type="button" className="underline hover:text-white" onClick={() => openChronology(id)}>Перевірити: {soldiersMap.get(id)?.name || id}</button>)}</div>
                    </div>}
                    
                    {/* Командний заголовок */}
                    <header className="bg-[#17181b] border border-[#2e3138] rounded-sm p-2.5 sm:p-3 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3">
                        
                        {/* 1. Ліва частина: Логотип + Назва */}
                        <div className="flex items-center gap-2.5 shrink-0">
                            <div className="w-8 h-8 rounded-sm bg-[#122624] border border-[#14b8a6]/55 flex items-center justify-center text-[#2dd4bf] shrink-0">
                                <Icon name="shield-alert" className="w-4 h-4" />
                            </div>
                            <h1 className="text-sm sm:text-base font-bold text-[#f3f4f6] tracking-tight whitespace-nowrap">MedTactical</h1>
                        </div>

                        {/* 2. Центральна частина: Сегментована панель вкладок (32px) */}
                        <div className="flex items-center gap-1 bg-[#101113] border border-[#2e3138] p-1 rounded-sm shrink-0 self-start xl:self-center flex-wrap">
                            {/* Вкладка: Втрати о/с */}
                            <button 
                                onClick={() => handleTabSwitch("list")} 
                                aria-label={`Журнал ${stats.lossesCount}`}
                                title="Журнал втрат особового складу (300, 200, ЗБВ)"
                                className={`h-8 px-3 rounded-sm border transition-colors inline-flex items-center gap-2 text-xs font-medium cursor-pointer select-none leading-none shrink-0 ${
                                    activeTab === "list" 
                                        ? "bg-[#122624] text-[#f0fdfa] border-[#14b8a6]/65 font-semibold" 
                                        : "border-transparent text-[#9aa6b8] hover:text-[#e6edf5] hover:bg-[#20262f]"
                                }`}
                            >
                                <Icon name="activity" className={`w-3.5 h-3.5 shrink-0 ${activeTab === "list" ? "text-[#2dd4bf]" : "text-[#9aa6b8]"}`} />
                                <span>Втрати о/с</span>
                                <span className={`h-[20px] px-1.5 rounded-sm border inline-flex items-center justify-center text-[10.5px] font-mono font-bold tabular-nums leading-none shrink-0 ${
                                    activeTab === "list" 
                                        ? "bg-[#0d1c1a] border-[#14b8a6]/45 text-[#5eead4]" 
                                        : "bg-[#14171c] border-[#2b3340] text-[#9aa6b8]"
                                }`}>
                                    {stats.lossesCount}
                                </span>
                            </button>

                            {/* Вкладка: Облік СЗЧ */}
                            <button 
                                onClick={() => handleTabSwitch("awol")} 
                                aria-label={`Облік СЗЧ ${stats.awolFilteredCount}`}
                                title="Облік військовослужбовців СЗЧ та дезертирства"
                                className={`h-8 px-3 rounded-sm border transition-colors inline-flex items-center gap-2 text-xs font-medium cursor-pointer select-none leading-none shrink-0 ${
                                    activeTab === "awol" 
                                        ? "bg-[#122624] text-[#f0fdfa] border-[#14b8a6]/65 font-semibold" 
                                        : "border-transparent text-[#9aa6b8] hover:text-[#e6edf5] hover:bg-[#20262f]"
                                }`}
                            >
                                <Icon name="user-x" className={`w-3.5 h-3.5 shrink-0 ${activeTab === "awol" ? "text-[#2dd4bf]" : "text-[#9aa6b8]"}`} />
                                <span>Облік СЗЧ</span>
                                <span className={`h-[20px] px-1.5 rounded-sm border inline-flex items-center justify-center text-[10.5px] font-mono font-bold tabular-nums leading-none shrink-0 ${
                                    activeTab === "awol"
                                        ? "bg-[#0d1c1a] border-[#14b8a6]/45 text-[#5eead4]"
                                        : "bg-[#14171c] border-[#2b3340] text-[#9aa6b8]"
                                }`}>
                                    {stats.awolFilteredCount}
                                </span>
                            </button>

                            {/* Вкладка: Черга евакуації */}
                            <button 
                                onClick={() => handleTabSwitch("triage")} 
                                className={`h-8 px-3 rounded-sm border transition-colors inline-flex items-center gap-2 text-xs font-medium cursor-pointer select-none leading-none shrink-0 ${
                                    activeTab === "triage" 
                                        ? "bg-[#122624] text-[#f0fdfa] border-[#14b8a6]/65 font-semibold" 
                                        : "border-transparent text-[#9aa6b8] hover:text-[#e6edf5] hover:bg-[#20262f]"
                                }`}
                            >
                                <Icon name="clock-3" className={`w-3.5 h-3.5 shrink-0 ${activeTab === "triage" ? "text-[#2dd4bf]" : "text-[#9aa6b8]"}`} />
                                <span>Евакуація</span>
                                <span className={`h-[20px] px-1.5 rounded-sm border inline-flex items-center justify-center text-[10.5px] font-mono font-bold tabular-nums leading-none shrink-0 ${
                                    activeTab === "triage"
                                        ? "bg-[#0d1c1a] border-[#14b8a6]/45 text-[#5eead4]"
                                        : triageEpisodes.length > 0
                                            ? "bg-[rgba(217,155,38,0.14)] border-[rgba(217,155,38,0.45)] text-[#fcd34d]"
                                            : "bg-[#14171c] border-[#2b3340] text-[#9aa6b8]"
                                }`}>
                                    {triageEpisodes.length}
                                </span>
                            </button>

                            {/* Вкладка: Аналітика */}
                            <button 
                                onClick={() => handleTabSwitch("analytics")} 
                                className={`h-8 px-3 rounded-sm border transition-colors inline-flex items-center gap-2 text-xs font-medium cursor-pointer select-none leading-none shrink-0 ${
                                    activeTab === "analytics" 
                                        ? "bg-[#122624] text-[#f0fdfa] border-[#14b8a6]/65 font-semibold" 
                                        : "border-transparent text-[#9aa6b8] hover:text-[#e6edf5] hover:bg-[#20262f]"
                                }`}
                            >
                                <Icon name="bar-chart-3" className={`w-3.5 h-3.5 shrink-0 ${activeTab === "analytics" ? "text-[#2dd4bf]" : "text-[#9aa6b8]"}`} />
                                <span>Аналітика</span>
                            </button>

                            {/* Вкладка: Лог */}
                            <button 
                                onClick={() => handleTabSwitch("logs")} 
                                className={`h-8 px-3 rounded-sm border transition-colors inline-flex items-center gap-2 text-xs font-medium cursor-pointer select-none leading-none shrink-0 ${
                                    activeTab === "logs" 
                                        ? "bg-[#122624] text-[#f0fdfa] border-[#14b8a6]/65 font-semibold" 
                                        : "border-transparent text-[#9aa6b8] hover:text-[#e6edf5] hover:bg-[#20262f]"
                                }`}
                            >
                                <Icon name="history" className={`w-3.5 h-3.5 shrink-0 ${activeTab === "logs" ? "text-[#2dd4bf]" : "text-[#9aa6b8]"}`} />
                                <span>Лог змін</span>
                            </button>
                        </div>

                        {/* 3. Права частина: Кнопки дій (32px) */}
                        <div className="flex items-center gap-2 flex-wrap shrink-0">
                            <button 
                                onClick={() => handleOpenAddWounded(null)} 
                                className="h-8 px-3.5 bg-[#2b67ab] hover:bg-[#3577c2] text-white font-semibold rounded-sm border border-[#4c8ed9]/60 transition-colors inline-flex items-center gap-1.5 text-xs cursor-pointer shrink-0 leading-none"
                            >
                                <Icon name="plus" className="w-3.5 h-3.5 shrink-0" /> 
                                <span>Створити запис</span>
                            </button>
                            
                            <button 
                                onClick={() => setIsBackupOpen(true)} 
                                className="h-8 px-3 bg-[#20262f] hover:bg-[#2b3340] text-[#e6edf5] border border-[#2b3340] hover:border-[#4c8ed9] rounded-sm transition-colors text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer shrink-0 leading-none" 
                                title="Управління базою, шифрований бекап AES-256"
                            >
                                <Icon name="shield-check" className="w-3.5 h-3.5 text-[#4c8ed9] shrink-0" /> 
                                <span>База / Бекап</span>
                            </button>
                        </div>
                    </header>

                    {notification && (
                        <div className="fixed top-20 right-6 z-[25000]">
                            <div className={`px-4 py-2.5 rounded-sm border flex items-center gap-2.5 text-xs font-medium ${notification.type === 'error' ? 'bg-[#17181b] border-[#d9534f] text-[#f3a3a0]' : 'bg-[#17181b] border-[#4c8ed9] text-[#f3f4f6]'}`}>
                                <Icon name={notification.type === 'error' ? 'alert-octagon' : 'check-circle'} className={`w-4 h-4 ${notification.type === 'error' ? 'text-[#f3a3a0]' : 'text-[#3da372]'}`} />
                                <span>{notification.text}</span>
                            </div>
                        </div>
                    )}

                    <main className="flex-1 w-full flex flex-col gap-3">
                        {/* ГОРИЗОНТАЛЬНА ВЕРХНЯ ПАНЕЛЬ ФІЛЬТРІВ (ДЛЯ ВТРАТ О/С, СЗЧ ТА ТРІАЖУ) */}
                        {(activeTab === "list" || activeTab === "awol" || activeTab === "triage") && (
                            <div className="w-full bg-[#17181b] border border-[#2e3138] rounded-sm p-2 sm:p-2.5 flex items-center gap-2 flex-wrap">
                                
                                {/* Пошук */}
                                <div className="relative min-w-[150px] max-w-[200px] flex-1 sm:flex-initial">
                                    <input 
                                        id="global-search-input"
                                        type="text" 
                                        placeholder="Пошук... [Ctrl+F]" 
                                        value={searchTerm} 
                                        onChange={(e) => setSearchTerm(e.target.value)} 
                                        className="w-full bg-[#101113] border border-[#2e3138] rounded-sm pl-7 pr-6 py-1.5 text-xs text-[#f3f4f6] placeholder-[#989fa9] focus:border-[#4c8ed9] outline-none transition-colors" 
                                    />
                                    <Icon name="search" className="w-3.5 h-3.5 text-[#989fa9] absolute left-2 top-2" />
                                    {searchTerm && (
                                        <button onClick={() => setSearchTerm("")} className="absolute right-1.5 top-2 text-[#989fa9] hover:text-[#f3f4f6] cursor-pointer" title="Очистити">
                                            <Icon name="x" className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>

                                {/* Фільтр дат: Всі дати + Календар (діапазон) */}
                                <div className="flex items-center gap-0.5 bg-[#101113] p-0.5 rounded-sm border border-[#2e3138] text-xs font-mono">
                                    <button 
                                        type="button" 
                                        onClick={() => applyDatePreset('all')} 
                                        className={`px-2.5 py-1 rounded-sm transition-colors cursor-pointer select-none text-[11px] ${datePreset === 'all' ? 'bg-[#2b67ab] text-white font-semibold' : 'text-[#b8bec8] hover:text-[#f3f4f6]'}`}
                                    >
                                        Всі дати
                                    </button>

                                    {/* Точний період (календар-поповер) */}
                                    <div className="relative">
                                        <button 
                                            type="button" 
                                            onClick={() => setOpenDropdown(openDropdown === 'custom_date' ? null : 'custom_date')} 
                                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm transition-colors cursor-pointer select-none text-[11px] tabular-nums ${datePreset === 'custom' ? 'bg-[#2b67ab] text-white font-semibold' : 'text-[#b8bec8] hover:text-[#f3f4f6]'}`}
                                            title="Вибрати період дат у календарі"
                                        >
                                            <Icon name="calendar" className={`w-3.5 h-3.5 ${datePreset === 'custom' ? 'text-white' : 'text-[#4c8ed9]'}`} />
                                            <span>{datePreset === 'custom' && listDateFrom ? `${listDateFrom.slice(5)} — ${listDateTo ? listDateTo.slice(5) : '...'}` : 'Календар'}</span>
                                            <Icon name="chevron-down" className="w-2.5 h-2.5 text-[#989fa9]" />
                                        </button>
                                        {openDropdown === 'custom_date' && (
                                            <>
                                                <div className="fixed inset-0 z-40 cursor-default" onClick={() => setOpenDropdown(null)}></div>
                                                <div className="absolute left-0 top-full mt-1 z-50 bg-[#17181b] border border-[#2e3138] rounded-sm p-3.5 w-72 max-w-[calc(100vw-32px)] space-y-3 font-sans">
                                                    <div className="flex justify-between items-center pb-2 border-b border-[#2e3138]">
                                                        <span className="text-xs font-semibold text-[#f3f4f6] flex items-center gap-1.5">
                                                            <Icon name="calendar" className="w-4 h-4 text-[#4c8ed9]" />
                                                            <span>Період дат</span>
                                                        </span>
                                                        <button 
                                                            type="button" 
                                                            onClick={() => { applyDatePreset('all'); setOpenDropdown(null); }} 
                                                            className="text-[11px] text-[#4c8ed9] hover:text-[#6fa8e6] font-medium cursor-pointer"
                                                        >
                                                            Скинути
                                                        </button>
                                                    </div>
                                                    <div className="space-y-2.5 text-xs">
                                                        <div>
                                                            <span className="text-[10px] font-semibold text-[#b8bec8] uppercase font-mono block mb-1">Від дати:</span>
                                                            <input 
                                                                type="date" 
                                                                value={listDateFrom} 
                                                                onChange={(e) => { setListDateFrom(e.target.value); setDatePreset('custom'); }} 
                                                                className="w-full bg-[#101113] border border-[#2e3138] rounded-sm px-2.5 py-1.5 text-xs text-[#f3f4f6] focus:border-[#4c8ed9] outline-none font-mono tabular-nums" 
                                                            />
                                                        </div>
                                                        <div>
                                                            <span className="text-[10px] font-semibold text-[#b8bec8] uppercase font-mono block mb-1">До дати:</span>
                                                            <input 
                                                                type="date" 
                                                                value={listDateTo} 
                                                                onChange={(e) => { setListDateTo(e.target.value); setDatePreset('custom'); }} 
                                                                className="w-full bg-[#101113] border border-[#2e3138] rounded-sm px-2.5 py-1.5 text-xs text-[#f3f4f6] focus:border-[#4c8ed9] outline-none font-mono tabular-nums" 
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="pt-2 border-t border-[#2e3138] flex justify-end">
                                                        <button 
                                                            type="button" 
                                                            onClick={() => setOpenDropdown(null)} 
                                                            className="w-full py-1.5 bg-[#2b67ab] hover:bg-[#3577c2] text-white font-medium text-xs rounded-sm border border-[#4c8ed9]/60 transition-colors cursor-pointer text-center"
                                                        >
                                                            Застосувати
                                                        </button>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Дропдаун: Тип втрати (для Втрат о/с) */}
                                {activeTab === "list" && (
                                    <FilterDropdown 
                                        title="Тип втрати" 
                                        count={filterLossTypes.filter(t => !isAwol(t)).length} 
                                        total={LOSS_TYPES.filter(t => !isAwol(t)).length} 
                                        isOpen={openDropdown === 'types'} 
                                        onToggle={() => setOpenDropdown(openDropdown === 'types' ? null : 'types')}
                                        onSelectAll={() => setFilterLossTypes(prev => [...prev.filter(isAwol), ...LOSS_TYPES.filter(t => !isAwol(t))])}
                                        onClearAll={() => setFilterLossTypes(prev => prev.filter(isAwol))}
                                    >
                                        <CheckboxList 
                                            items={LOSS_TYPES.filter(t => !isAwol(t))} 
                                            selected={filterLossTypes} 
                                            toggle={(v) => toggleFilterItem(filterLossTypes, setFilterLossTypes, v)} 
                                            onSelectOnly={(v) => setFilterLossTypes(prev => [...prev.filter(isAwol), v])} 
                                        />
                                    </FilterDropdown>
                                )}

                                {/* Дропдаун: Категорія СЗЧ (для Обліку СЗЧ) */}
                                {activeTab === "awol" && (
                                    <FilterDropdown 
                                        title="Категорія" 
                                        count={filterLossTypes.filter(isAwol).length} 
                                        total={LOSS_TYPES.filter(isAwol).length} 
                                        isOpen={openDropdown === 'types'} 
                                        onToggle={() => setOpenDropdown(openDropdown === 'types' ? null : 'types')}
                                        onSelectAll={() => setFilterLossTypes(prev => [...prev.filter(t => !isAwol(t)), ...LOSS_TYPES.filter(isAwol)])}
                                        onClearAll={() => setFilterLossTypes(prev => prev.filter(t => !isAwol(t)))}
                                    >
                                        <CheckboxList 
                                            items={LOSS_TYPES.filter(isAwol)} 
                                            selected={filterLossTypes} 
                                            toggle={(v) => toggleFilterItem(filterLossTypes, setFilterLossTypes, v)} 
                                            onSelectOnly={(v) => {
                                                setFilterLossTypes(prev => [...prev.filter(t => !isAwol(t)), v]);
                                                if (v === "Повернення з СЗЧ") {
                                                    setFilterEvacStatuses(prev => Array.from(new Set([...prev, "Повернувся"])));
                                                } else if (v === "СЗЧ") {
                                                    setFilterEvacStatuses(prev => Array.from(new Set([...prev, "В розшуку"])));
                                                }
                                            }} 
                                        />
                                    </FilterDropdown>
                                )}

                                {/* Дропдаун: Евакуація (для Втрат о/с та Тріажу) */}
                                {activeTab !== "awol" && (
                                    <FilterDropdown 
                                        title="Евакуація" 
                                        count={filterEvacStatuses.filter(s => s !== "В розшуку" && s !== "Повернувся").length} 
                                        total={3} 
                                        isOpen={openDropdown === 'evac'} 
                                        onToggle={() => setOpenDropdown(openDropdown === 'evac' ? null : 'evac')}
                                        onSelectAll={() => setFilterEvacStatuses(prev => Array.from(new Set([...prev, "Не евакуйований", "Евакуйований", "Не потребує евакуації"])))}
                                        onClearAll={() => setFilterEvacStatuses(prev => prev.filter(s => s === "В розшуку" || s === "Повернувся"))}
                                    >
                                        <div className="flex gap-1 mb-2 p-1 bg-[#101113] rounded-sm border border-[#2e3138] text-[10px] font-mono tabular-nums">
                                            <button 
                                                type="button" 
                                                onClick={() => setFilterEvacStatuses(prev => [...prev.filter(s => s === "В розшуку" || s === "Повернувся"), "Не евакуйований"])} 
                                                className="flex-1 py-1 rounded-sm bg-[#d9534f]/10 border border-[#d9534f]/30 hover:bg-[#d9534f]/20 text-[#f3a3a0] font-semibold text-center cursor-pointer transition-colors"
                                                title="Показати тільки тих, хто очікує на евакуацію"
                                            >
                                                Очікують
                                            </button>
                                            <button 
                                                type="button" 
                                                onClick={() => setFilterEvacStatuses(prev => [...prev.filter(s => s === "В розшуку" || s === "Повернувся"), "Евакуйований"])} 
                                                className="flex-1 py-1 rounded-sm bg-[#3da372]/10 border border-[#3da372]/30 hover:bg-[#3da372]/20 text-[#8ad8ae] font-semibold text-center cursor-pointer transition-colors"
                                                title="Показати тільки евакуйованих"
                                            >
                                                Евакуйовані
                                            </button>
                                        </div>
                                        <CheckboxList 
                                            items={["Не евакуйований", "Евакуйований", "Не потребує евакуації"]} 
                                            selected={filterEvacStatuses} 
                                            toggle={(v) => toggleFilterItem(filterEvacStatuses, setFilterEvacStatuses, v)} 
                                            onSelectOnly={(v) => setFilterEvacStatuses(prev => [...prev.filter(s => s === "В розшуку" || s === "Повернувся"), v])} 
                                            maxH={false} 
                                        />
                                    </FilterDropdown>
                                )}

                                {/* Дропдаун: Статус розшуку (для Обліку СЗЧ) */}
                                {activeTab === "awol" && (
                                    <FilterDropdown 
                                        title="Статус розшуку" 
                                        count={filterEvacStatuses.filter(s => s === "В розшуку" || s === "Повернувся").length} 
                                        total={2} 
                                        isOpen={openDropdown === 'evac'} 
                                        onToggle={() => setOpenDropdown(openDropdown === 'evac' ? null : 'evac')}
                                        onSelectAll={() => setFilterEvacStatuses(prev => Array.from(new Set([...prev, "В розшуку", "Повернувся"])))}
                                        onClearAll={() => setFilterEvacStatuses(prev => prev.filter(s => s !== "В розшуку" && s !== "Повернувся"))}
                                    >
                                        <div className="flex gap-1 mb-2 p-1 bg-[#101113] rounded-sm border border-[#2e3138] text-[10px] font-mono">
                                            <button 
                                                type="button" 
                                                onClick={() => setFilterEvacStatuses(prev => [...prev.filter(s => s !== "В розшуку" && s !== "Повернувся"), "В розшуку"])} 
                                                className="flex-1 py-1 rounded-sm bg-[#8f5fb8]/15 hover:bg-[#8f5fb8]/25 text-[#c084fc] font-medium text-center cursor-pointer transition-colors"
                                                title="Показати тих, хто в розшуку"
                                            >
                                                В розшуку
                                            </button>
                                            <button 
                                                type="button" 
                                                onClick={() => setFilterEvacStatuses(prev => [...prev.filter(s => s !== "В розшуку" && s !== "Повернувся"), "Повернувся"])} 
                                                className="flex-1 py-1 rounded-sm bg-[#3da372]/15 hover:bg-[#3da372]/25 text-[#3da372] font-medium text-center cursor-pointer transition-colors"
                                                title="Показати тих, хто повернувся"
                                            >
                                                Повернувся
                                            </button>
                                        </div>
                                        <CheckboxList 
                                            items={["В розшуку", "Повернувся"]} 
                                            selected={filterEvacStatuses} 
                                            toggle={(v) => toggleFilterItem(filterEvacStatuses, setFilterEvacStatuses, v)} 
                                            onSelectOnly={(v) => setFilterEvacStatuses(prev => [...prev.filter(s => s !== "В розшуку" && s !== "Повернувся"), v])} 
                                            maxH={false} 
                                        />
                                    </FilterDropdown>
                                )}

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
                                                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-sm border text-xs font-semibold transition-colors cursor-pointer select-none ${
                                                    otherActiveCount > 0
                                                        ? 'bg-[#4c8ed9]/15 border-[#4c8ed9]/50 text-[#e6edf3]'
                                                        : 'bg-[#101113] border-[#2e3138] text-[#b8bec8] hover:text-[#e6edf3] hover:bg-[#222429]'
                                                }`}
                                            >
                                                <Icon name="sliders-horizontal" className="w-3.5 h-3.5" />
                                                <span>Інше</span>
                                                {otherActiveCount > 0 && (
                                                    <span className="w-4 h-4 rounded-sm bg-[#2b67ab] text-white font-bold text-[10px] flex items-center justify-center font-mono tabular-nums">
                                                        {otherActiveCount}
                                                    </span>
                                                )}
                                                <Icon name={openDropdown === 'other' ? 'chevron-up' : 'chevron-down'} className="w-3 h-3 text-[#989fa9]" />
                                            </button>

                                            {openDropdown === 'other' && (
                                                <>
                                                    <div className="fixed inset-0 z-40 cursor-default" onClick={() => setOpenDropdown(null)}></div>
                                                    <div className="absolute right-0 top-full mt-1.5 z-50 bg-[#17181b] border border-[#2e3138] rounded-sm p-4 w-[400px] max-w-[calc(100vw-32px)] space-y-3.5 font-sans">
                                                        <div className="flex justify-between items-center pb-2.5 border-b border-[#2e3138]">
                                                            <div className="flex items-center gap-1.5 font-bold text-xs text-[#e6edf3]">
                                                                <Icon name="sliders-horizontal" className="w-3.5 h-3.5 text-[#4c8ed9]" />
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
                                                                className="text-[11px] text-[#4c8ed9] hover:text-[#e6edf3] font-semibold cursor-pointer"
                                                            >
                                                                Скинути ці
                                                            </button>
                                                        </div>

                                                        {/* 1. Важкість стану */}
                                                        <div className="space-y-1.5">
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-[10px] font-bold text-[#b8bec8] uppercase font-mono">Важкість (300):</span>
                                                                <div className="flex gap-2 text-[10px] font-mono">
                                                                    <button type="button" onClick={() => setFilterSeverities(["Легкий", "Середній", "Важкий", "Критичний"])} className="text-[#4c8ed9] hover:underline">Всі</button>
                                                                    <button type="button" onClick={() => setFilterSeverities([])} className="text-[#b8bec8] hover:underline">Зняти</button>
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-1.5">
                                                                {["Легкий", "Середній", "Важкий", "Критичний"].map(sev => (
                                                                    <label key={sev} className="flex items-center gap-1.5 text-xs text-[#e6edf3] bg-[#101113] px-2.5 py-1.5 rounded-sm border border-[#2e3138] cursor-pointer hover:border-[#3c404a] select-none">
                                                                        <input type="checkbox" checked={filterSeverities.includes(sev)} onChange={() => toggleFilterItem(filterSeverities, setFilterSeverities, sev)} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#4c8ed9] focus:ring-0 w-3.5 h-3.5 shrink-0"/>
                                                                        <span className="whitespace-nowrap">{sev}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {/* 2. Причина ураження */}
                                                        <div className="space-y-1.5">
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-[10px] font-bold text-[#b8bec8] uppercase font-mono tabular-nums">Причина ({filterCauses.length}/{settings.causes.length}):</span>
                                                                <div className="flex gap-2 text-[10px] font-mono">
                                                                    <button type="button" onClick={() => setFilterCauses(settings.causes)} className="text-[#4c8ed9] hover:underline">Всі</button>
                                                                    <button type="button" onClick={() => setFilterCauses([])} className="text-[#b8bec8] hover:underline">Зняти</button>
                                                                </div>
                                                            </div>
                                                            <div className="max-h-28 overflow-y-auto space-y-1 pr-1 bg-[#101113] p-2 rounded-sm border border-[#2e3138]">
                                                                {settings.causes.map(c => (
                                                                    <label key={c} className="flex items-center gap-2 text-xs text-[#b8bec8] hover:text-[#e6edf3] cursor-pointer select-none py-0.5">
                                                                        <input type="checkbox" checked={filterCauses.includes(c)} onChange={() => toggleFilterItem(filterCauses, setFilterCauses, c)} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#4c8ed9] focus:ring-0 w-3.5 h-3.5 shrink-0"/>
                                                                        <span className="whitespace-nowrap">{c}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {/* 3. Рапорт & УПД */}
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <div className="space-y-1">
                                                                <span className="text-[10px] font-bold text-[#b8bec8] uppercase font-mono">Рапорт:</span>
                                                                <select value={filterReport} onChange={(e) => setFilterReport(e.target.value)} className="w-full bg-[#101113] border border-[#2e3138] rounded-sm px-2 py-1.5 text-xs text-[#e6edf3] outline-none cursor-pointer focus:border-[#4c8ed9]">
                                                                    <option value="all">Всі випадки</option>
                                                                    <option value="yes">Складено</option>
                                                                    <option value="no">Без рапорту</option>
                                                                </select>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <span className="text-[10px] font-bold text-[#b8bec8] uppercase font-mono">УПД:</span>
                                                                <select value={filterUdp} onChange={(e) => setFilterUdp(e.target.value)} className="w-full bg-[#101113] border border-[#2e3138] rounded-sm px-2 py-1.5 text-xs text-[#e6edf3] outline-none cursor-pointer focus:border-[#4c8ed9]">
                                                                    <option value="all">Всі випадки</option>
                                                                    <option value="yes">Під час УПД</option>
                                                                    <option value="no">Без УПД</option>
                                                                </select>
                                                            </div>
                                                        </div>

                                                        {/* 4. Травми */}
                                                        <div className="space-y-1.5">
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-[10px] font-bold text-[#b8bec8] uppercase font-mono tabular-nums">Типи травм ({filterInjuries.length}):</span>
                                                                {filterInjuries.length > 0 && (
                                                                    <button type="button" onClick={() => setFilterInjuries([])} className="text-[10px] font-mono text-[#b8bec8] hover:underline">Зняти</button>
                                                                )}
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-1.5 max-h-28 overflow-y-auto bg-[#101113] p-2 rounded-sm border border-[#2e3138]">
                                                                {Object.entries(INJURY_LABELS).map(([k, l]) => ({ k, l })).map(item => (
                                                                    <label key={item.k} className="flex items-center gap-1.5 text-xs text-[#b8bec8] hover:text-[#e6edf3] cursor-pointer select-none">
                                                                        <input type="checkbox" checked={filterInjuries.includes(item.k)} onChange={() => toggleFilterItem(filterInjuries, setFilterInjuries, item.k)} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#4c8ed9] focus:ring-0 w-3.5 h-3.5 shrink-0"/>
                                                                        <span className="whitespace-nowrap">{item.l}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {/* 5. Статус зброї */}
                                                        <div className="space-y-1.5">
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-[10px] font-bold text-[#b8bec8] uppercase font-mono tabular-nums">Статус зброї ({filterWeapon.length}):</span>
                                                                {filterWeapon.length > 0 && (
                                                                    <button type="button" onClick={() => setFilterWeapon([])} className="text-[10px] font-mono text-[#b8bec8] hover:underline">Зняти</button>
                                                                )}
                                                            </div>
                                                            <div className="max-h-24 overflow-y-auto space-y-1 bg-[#101113] p-2 rounded-sm border border-[#2e3138]">
                                                                {["втрачена", "знищена", "знаходиться у підрозділі", "знаходиться на позиції", "СЗЧ/Дезертирство зі зброєю", "Не вказано"].map(w => (
                                                                    <label key={w} className="flex items-center gap-1.5 text-xs text-[#b8bec8] hover:text-[#e6edf3] cursor-pointer select-none py-0.5">
                                                                        <input type="checkbox" checked={filterWeapon.includes(w)} onChange={() => toggleFilterItem(filterWeapon, setFilterWeapon, w)} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#4c8ed9] focus:ring-0 w-3.5 h-3.5 shrink-0"/>
                                                                        <span className="whitespace-nowrap">{w}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        <div className="pt-2 border-t border-[#2e3138] flex justify-end">
                                                            <button 
                                                                type="button" 
                                                                onClick={() => setOpenDropdown(null)} 
                                                                className="w-full py-2 bg-[#2b67ab] hover:bg-[#3678c4] border border-[#4c8ed9] text-white font-semibold text-xs rounded-sm transition-colors cursor-pointer text-center"
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
                                {(activeTab === "list" || activeTab === "awol") && (
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() => setOpenDropdown(openDropdown === 'sort' ? null : 'sort')}
                                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-sm border text-xs font-semibold transition-colors cursor-pointer select-none tabular-nums ${
                                                sortBy.startsWith('evac')
                                                    ? 'bg-[#3da372]/15 border-[#3da372]/50 text-[#8ad8ae]'
                                                    : sortBy !== 'date_desc'
                                                        ? 'bg-[#d99b26]/15 border-[#d99b26]/50 text-[#e7c574]'
                                                        : 'bg-[#101113] border-[#2e3138] text-[#b8bec8] hover:text-[#e6edf3] hover:border-[#3c404a]'
                                            }`}
                                            title="Сортування списку втрат"
                                        >
                                            <Icon name="arrow-up-down" className={`w-3.5 h-3.5 ${sortBy.startsWith('evac') ? 'text-[#8ad8ae]' : sortBy !== 'date_desc' ? 'text-[#e7c574]' : 'text-[#4c8ed9]'}`} />
                                            <span className="font-bold text-[11px] flex items-center gap-1">
                                                {(sortBy === 'evac_desc' || sortBy === 'evac_asc') && <Icon name="ambulance" className="w-3 h-3" />}
                                                {(sortBy === 'date_desc' || sortBy === 'date_asc') && <Icon name="clock" className="w-3 h-3" />}
                                                {(sortBy === 'name_asc' || sortBy === 'name_desc') && <Icon name="user" className="w-3 h-3" />}
                                                {sortBy === 'severity_desc' && <Icon name="alert-triangle" className="w-3 h-3 text-[#f3a3a0]" />}
                                                <span>
                                                    {sortBy === 'evac_desc' && 'Евак ↓'}
                                                    {sortBy === 'evac_asc' && 'Евак ↑'}
                                                    {sortBy === 'date_desc' && 'Подія ↓'}
                                                    {sortBy === 'date_asc' && 'Подія ↑'}
                                                    {sortBy === 'name_asc' && 'А → Я'}
                                                    {sortBy === 'name_desc' && 'Я → А'}
                                                    {sortBy === 'severity_desc' && 'Важкість ↓'}
                                                </span>
                                            </span>
                                            <Icon name={openDropdown === 'sort' ? 'chevron-up' : 'chevron-down'} className="w-3 h-3 text-[#989fa9]" />
                                        </button>

                                        {openDropdown === 'sort' && (
                                            <>
                                                <div className="fixed inset-0 z-40 cursor-default" onClick={() => setOpenDropdown(null)}></div>
                                                <div className="absolute right-0 top-full mt-1.5 z-50 bg-[#17181b] border border-[#2e3138] rounded-sm p-2 w-64 max-w-[calc(100vw-32px)] space-y-1 font-sans">
                                                    <div className="px-2.5 py-1.5 text-[10px] font-mono uppercase font-bold text-[#989fa9] border-b border-[#2e3138] flex items-center justify-between">
                                                        <span>Оберіть сортування</span>
                                                    </div>

                                                    <div className="pt-1 space-y-0.5 text-xs">
                                                        <button
                                                            type="button"
                                                            onClick={() => { setSortBy('evac_desc'); setOpenDropdown(null); }}
                                                            className={`w-full text-left px-2.5 py-2 rounded-sm flex items-center justify-between transition-colors cursor-pointer ${sortBy === 'evac_desc' ? 'bg-[#3da372]/15 text-[#8ad8ae] font-bold border border-[#3da372]/45' : 'text-[#b8bec8] hover:bg-[#222429] hover:text-[#e6edf3] border border-transparent'}`}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <Icon name="ambulance" className="w-3.5 h-3.5 text-[#3da372]" />
                                                                <span>Дата евакуації (новіші зверху)</span>
                                                            </span>
                                                            {sortBy === 'evac_desc' && <Icon name="check" className="w-3.5 h-3.5 text-[#8ad8ae]" />}
                                                        </button>

                                                        <button
                                                            type="button"
                                                            onClick={() => { setSortBy('evac_asc'); setOpenDropdown(null); }}
                                                            className={`w-full text-left px-2.5 py-2 rounded-sm flex items-center justify-between transition-colors cursor-pointer ${sortBy === 'evac_asc' ? 'bg-[#3da372]/15 text-[#8ad8ae] font-bold border border-[#3da372]/45' : 'text-[#b8bec8] hover:bg-[#222429] hover:text-[#e6edf3] border border-transparent'}`}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <Icon name="ambulance" className="w-3.5 h-3.5 text-[#3da372]" />
                                                                <span>Дата евакуації (старіші зверху)</span>
                                                            </span>
                                                            {sortBy === 'evac_asc' && <Icon name="check" className="w-3.5 h-3.5 text-[#8ad8ae]" />}
                                                        </button>

                                                        <div className="my-1 border-t border-[#2e3138]"></div>

                                                        <button
                                                            type="button"
                                                            onClick={() => { setSortBy('date_desc'); setOpenDropdown(null); }}
                                                            className={`w-full text-left px-2.5 py-2 rounded-sm flex items-center justify-between transition-colors cursor-pointer ${sortBy === 'date_desc' ? 'bg-[#d99b26]/15 text-[#e7c574] font-bold border border-[#d99b26]/45' : 'text-[#b8bec8] hover:bg-[#222429] hover:text-[#e6edf3] border border-transparent'}`}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <Icon name="clock" className="w-3.5 h-3.5 text-[#d99b26]" />
                                                                <span>Дата події (новіші зверху)</span>
                                                            </span>
                                                            {sortBy === 'date_desc' && <Icon name="check" className="w-3.5 h-3.5 text-[#e7c574]" />}
                                                        </button>

                                                        <button
                                                            type="button"
                                                            onClick={() => { setSortBy('date_asc'); setOpenDropdown(null); }}
                                                            className={`w-full text-left px-2.5 py-2 rounded-sm flex items-center justify-between transition-colors cursor-pointer ${sortBy === 'date_asc' ? 'bg-[#d99b26]/15 text-[#e7c574] font-bold border border-[#d99b26]/45' : 'text-[#b8bec8] hover:bg-[#222429] hover:text-[#e6edf3] border border-transparent'}`}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <Icon name="clock" className="w-3.5 h-3.5 text-[#d99b26]" />
                                                                <span>Дата події (старіші зверху)</span>
                                                            </span>
                                                            {sortBy === 'date_asc' && <Icon name="check" className="w-3.5 h-3.5 text-[#e7c574]" />}
                                                        </button>

                                                        <div className="my-1 border-t border-[#2e3138]"></div>

                                                        <button
                                                            type="button"
                                                            onClick={() => { setSortBy('severity_desc'); setOpenDropdown(null); }}
                                                            className={`w-full text-left px-2.5 py-2 rounded-sm flex items-center justify-between transition-colors cursor-pointer ${sortBy === 'severity_desc' ? 'bg-[#8f5fb8]/15 text-[#d8b4fe] font-bold border border-[#8f5fb8]/45' : 'text-[#b8bec8] hover:bg-[#222429] hover:text-[#e6edf3] border border-transparent'}`}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <Icon name="alert-triangle" className="w-3.5 h-3.5 text-[#c084fc]" />
                                                                <span>Важкість (Критичні → Легкі)</span>
                                                            </span>
                                                            {sortBy === 'severity_desc' && <Icon name="check" className="w-3.5 h-3.5 text-[#d8b4fe]" />}
                                                        </button>

                                                        <button
                                                            type="button"
                                                            onClick={() => { setSortBy('name_asc'); setOpenDropdown(null); }}
                                                            className={`w-full text-left px-2.5 py-2 rounded-sm flex items-center justify-between transition-colors cursor-pointer ${sortBy === 'name_asc' ? 'bg-[#4c8ed9]/15 text-[#9bc5f4] font-bold border border-[#4c8ed9]/45' : 'text-[#b8bec8] hover:bg-[#222429] hover:text-[#e6edf3] border border-transparent'}`}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <Icon name="user" className="w-3.5 h-3.5 text-[#4c8ed9]" />
                                                                <span>ПІБ бійця (А → Я)</span>
                                                            </span>
                                                            {sortBy === 'name_asc' && <Icon name="check" className="w-3.5 h-3.5 text-[#9bc5f4]" />}
                                                        </button>

                                                        <button
                                                            type="button"
                                                            onClick={() => { setSortBy('name_desc'); setOpenDropdown(null); }}
                                                            className={`w-full text-left px-2.5 py-2 rounded-sm flex items-center justify-between transition-colors cursor-pointer ${sortBy === 'name_desc' ? 'bg-[#4c8ed9]/15 text-[#9bc5f4] font-bold border border-[#4c8ed9]/45' : 'text-[#b8bec8] hover:bg-[#222429] hover:text-[#e6edf3] border border-transparent'}`}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <Icon name="user" className="w-3.5 h-3.5 text-[#4c8ed9]" />
                                                                <span>ПІБ бійця (Я → А)</span>
                                                            </span>
                                                            {sortBy === 'name_desc' && <Icon name="check" className="w-3.5 h-3.5 text-[#9bc5f4]" />}
                                                        </button>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}

                                {/* РЯДОК 2: Зведена статистика + Записів + Актуальні & Скинути */}
                                <div className="w-full flex items-center justify-between gap-2 border-t border-[#2e3138] pt-2 flex-wrap">
                                    {/* Зведена швидка статистика */}
                                    {activeTab === "list" ? (
                                        <div className="flex items-center gap-2 bg-[#101113] px-2.5 py-1 rounded-sm border border-[#2e3138] text-xs tabular-nums">
                                            <span className="text-[#e6edf3] text-xs font-semibold flex items-center gap-1" title="Унікальних військових у базі втрат">
                                                <Icon name="users" className="w-3.5 h-3.5 text-[#b8bec8]" />
                                                <span className="font-mono text-[#e6edf3] font-bold">{stats.lossesSoldiersCount}</span>
                                                <span className="text-[#989fa9] text-[10px]">в/сл</span>
                                            </span>
                                            <span className="text-[#2e3138] font-mono">|</span>
                                            <span className="text-[#e7c574] text-xs flex items-center gap-1 font-mono" title="Поранення та небойові травми (300)">
                                                <span className="text-[#d99b26] font-sans text-[10px] font-semibold">300:</span>
                                                <span className="text-[#f3d88e] font-bold">{stats.count300}</span>
                                            </span>
                                            <span className="text-[#2e3138] font-mono">|</span>
                                            <span className="text-[#e6edf3] text-xs flex items-center gap-1 font-mono" title="Загибель (200)">
                                                <span className="text-[#b8bec8] font-sans text-[10px] font-semibold">200:</span>
                                                <span className="text-[#e6edf3] font-bold">{stats.deadCount}</span>
                                            </span>
                                            <span className="text-[#2e3138] font-mono">|</span>
                                            <span className="text-[#9fc5ef] text-xs flex items-center gap-1 font-mono" title="Зниклі безвісти (ЗБВ)">
                                                <span className="text-[#4c8ed9] font-sans text-[10px] font-semibold">ЗБВ:</span>
                                                <span className="text-[#c5ddf8] font-bold">{stats.miaCount}</span>
                                            </span>
                                        </div>
                                    ) : activeTab === "awol" ? (() => {
                                        const hasSearching = filterEvacStatuses.includes("В розшуку");
                                        const hasReturned = filterEvacStatuses.includes("Повернувся");
                                        const awolQuickMode = (hasSearching && hasReturned) ? 'all' : hasSearching ? 'searching' : hasReturned ? 'returned' : 'none';
                                        const ensureAwolTypes = () => setFilterLossTypes(prev => Array.from(new Set([...prev, ...LOSS_TYPES.filter(isAwol)])));
                                        return (
                                            <div className="flex items-center gap-1 bg-[#101113] p-1 rounded-sm border border-[#2e3138] text-xs tabular-nums">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        ensureAwolTypes();
                                                        setFilterEvacStatuses(prev => Array.from(new Set([...prev, "В розшуку", "Повернувся"])));
                                                    }}
                                                    className={`px-2.5 py-1 rounded-sm border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer select-none ${
                                                        awolQuickMode === 'all'
                                                            ? 'bg-[#8f5fb8]/20 border-[#8f5fb8]/50 text-[#e9d5ff]'
                                                            : 'border-transparent text-[#b8bec8] hover:text-[#e6edf3] hover:bg-[#222429]'
                                                    }`}
                                                    title="Показати всі записи СЗЧ та повернення"
                                                >
                                                    <Icon name="users" className="w-3.5 h-3.5 text-[#c084fc]" />
                                                    <span className="text-[11px]">Усі:</span>
                                                    <span className="font-mono font-bold">{stats.awolTotal}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        ensureAwolTypes();
                                                        setFilterEvacStatuses(prev => [...prev.filter(s => s !== "В розшуку" && s !== "Повернувся"), "В розшуку"]);
                                                    }}
                                                    className={`px-2.5 py-1 rounded-sm border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer select-none ${
                                                        awolQuickMode === 'searching'
                                                            ? 'bg-[#8f5fb8]/20 border-[#8f5fb8]/50 text-[#e9d5ff]'
                                                            : 'border-transparent text-[#b8bec8] hover:text-[#e9d5ff] hover:bg-[#222429]'
                                                    }`}
                                                    title="Показати тільки тих, хто в розшуку (СЗЧ)"
                                                >
                                                    <Icon name="user-x" className="w-3.5 h-3.5 text-[#c084fc]" />
                                                    <span className="text-[11px]">В розшуку:</span>
                                                    <span className="font-mono font-bold text-[#e9d5ff]">{stats.awolCount}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        ensureAwolTypes();
                                                        setFilterEvacStatuses(prev => [...prev.filter(s => s !== "В розшуку" && s !== "Повернувся"), "Повернувся"]);
                                                    }}
                                                    className={`px-2.5 py-1 rounded-sm border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer select-none ${
                                                        awolQuickMode === 'returned'
                                                            ? 'bg-[#3da372]/20 border-[#3da372]/50 text-[#8ad8ae]'
                                                            : 'border-transparent text-[#b8bec8] hover:text-[#8ad8ae] hover:bg-[#222429]'
                                                    }`}
                                                    title="Показати тільки тих, хто повернувся з СЗЧ"
                                                >
                                                    <Icon name="check-circle" className="w-3.5 h-3.5 text-[#3da372]" />
                                                    <span className="text-[11px]">Повернулись:</span>
                                                    <span className="font-mono font-bold text-[#8ad8ae]">{stats.awolReturned}</span>
                                                </button>
                                            </div>
                                        );
                                    })() : (
                                        <div className="flex items-center gap-2 bg-[#101113] px-2.5 py-1 rounded-sm border border-[#2e3138] text-xs tabular-nums">
                                            <span className="text-[#e6edf3] text-xs font-semibold flex items-center gap-1" title="Унікальних військових у базі">
                                                <Icon name="users" className="w-3.5 h-3.5 text-[#b8bec8]" />
                                                <span className="font-mono text-[#e6edf3] font-bold">{stats.uniqueSoldiersCount}</span>
                                                <span className="text-[#989fa9] text-[10px]">в/сл</span>
                                            </span>
                                        </div>
                                    )}

                                    <div className="flex items-center gap-2 flex-wrap">
                                        {activeTab === "list" && (
                                            <div
                                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm border text-xs transition-colors tabular-nums ${
                                                    feedCutoffEnabled
                                                        ? "bg-[#4c8ed9]/10 border-[#4c8ed9]/50 text-[#e6edf3]"
                                                        : "bg-[#101113] border-[#2e3138] text-[#b8bec8]"
                                                }`}
                                                title="Показувати в основній стрічці лише записи починаючи з обраної дати (старіші записи згортаються внизу в архів, але враховуються в усій статистиці та черзі евакуації)"
                                            >
                                                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                                    <input
                                                        type="checkbox"
                                                        checked={feedCutoffEnabled}
                                                        onChange={(e) => handleToggleFeedCutoff(e.target.checked)}
                                                        className="rounded-sm bg-[#101113] border-[#3c404a] text-[#4c8ed9] focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                                                    />
                                                    <span className="font-semibold text-[11px] whitespace-nowrap">Відлік з:</span>
                                                </label>
                                                <input
                                                    type="date"
                                                    value={feedCutoffDate}
                                                    onChange={(e) => handleChangeFeedCutoffDate(e.target.value)}
                                                    className="bg-[#17181b] border border-[#2e3138] rounded-sm px-1.5 py-0.5 text-[11px] font-mono text-[#e6edf3] focus:border-[#4c8ed9] outline-none cursor-pointer"
                                                />
                                            </div>
                                        )}

                                        {(activeTab === "list" || activeTab === "awol") && (
                                            <div className="flex items-center gap-1.5 bg-[#101113] px-2.5 py-1.5 rounded-sm border border-[#2e3138] text-xs text-[#e6edf3] tabular-nums" title="Кількість відфільтрованих записів">
                                                <Icon name="list-filter" className="w-3.5 h-3.5 text-[#4c8ed9] shrink-0" />
                                                <span className="text-[11px] text-[#b8bec8] font-medium hidden sm:inline">Записів:</span>
                                                <span className="text-[#4c8ed9] font-mono font-bold text-xs">
                                                    {isFeedCutoffActive && olderArchiveList.length > 0
                                                        ? `${mainFilteredList.length} (+${olderArchiveList.length} в архіві)`
                                                        : (mainFilteredList.length > displayLimit ? `${visibleList.length} з ${mainFilteredList.length}` : mainFilteredList.length)}
                                                </span>
                                            </div>
                                        )}

                                        <label className="flex items-center gap-1.5 cursor-pointer text-[#b8bec8] hover:text-[#e6edf3] bg-[#101113] px-2.5 py-1.5 rounded-sm border border-[#2e3138] text-xs select-none" title="Показувати тільки один (останній) актуальний стан бійця">
                                            <input type="checkbox" checked={showOnlyLatest} onChange={(e) => setShowOnlyLatest(e.target.checked)} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#4c8ed9] focus:ring-0 w-3.5 h-3.5 cursor-pointer"/>
                                            <span className="font-medium text-[11px]">Актуальні</span>
                                        </label>

                                        <button 
                                            type="button" 
                                            onClick={resetAllFilters} 
                                            className="px-2.5 py-1.5 bg-[#101113] hover:bg-[#222429] text-[#b8bec8] hover:text-[#e6edf3] text-xs font-semibold rounded-sm border border-[#2e3138] transition-colors cursor-pointer flex items-center gap-1"
                                            title="Скинути всі фільтри"
                                        >
                                            <Icon name="rotate-ccw" className="w-3 h-3" />
                                            <span>Скинути</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ТАБ: ВТРАТИ О/С ТА ОБЛІК СЗЧ */}
                        {(activeTab === "list" || activeTab === "awol") && (
                            <div className="w-full space-y-3">
                                {filteredList.length === 0 ? (
                                    <div className="bg-[#17181b] border border-[#2e3138] rounded-sm p-12 text-center text-[#b8bec8] text-sm">
                                        {activeTab === "awol" ? "Жодного запису СЗЧ не знайдено за вказаними фільтрами" : "Жодного запису не знайдено за вказаними фільтрами"}
                                    </div>
                                ) : (
                                    <>
                                        {mainFilteredList.length === 0 && olderArchiveList.length > 0 ? (
                                            <div className="bg-[#17181b] border border-[#2e3138] rounded-sm p-6 text-center text-[#b8bec8] text-xs tabular-nums">
                                                Нових записів з <span className="font-mono font-bold text-[#e6edf3]">{feedCutoffDate.split('-').reverse().join('.')}</span> немає. Попередні записи ({olderArchiveList.length}) збережено в обліку нижче.
                                            </div>
                                        ) : (
                                            <div className="space-y-2.5">
                                                {visibleList.map((episode) => (
                                                    <EpisodeCard 
                                                        key={episode.id} 
                                                        episode={episode} 
                                                        soldier={soldiersMap.get(episode.soldierId)} 
                                                        soldierEpisodes={episodesBySoldier.get(episode.soldierId) || EMPTY_EPISODES}
                                                        onEdit={handleStartEdit}
                                                        onNotify={triggerNotification}
                                                        viewMode="list" onReview={openChronology} clockTick={clockTick}
                                                    />
                                                ))}
                                            </div>
                                        )}

                                        {/* Панель порційного підвантаження записів */}
                                        {mainFilteredList.length > displayLimit && (
                                            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-3 pb-2 tabular-nums">
                                                <button
                                                    type="button"
                                                    onClick={() => setDisplayLimit(prev => prev + 50)}
                                                    className="px-5 py-2 bg-[#17181b] hover:bg-[#222429] border border-[#2e3138] hover:border-[#4c8ed9] text-[#e6edf3] font-semibold text-xs rounded-sm transition-colors flex items-center gap-2 cursor-pointer"
                                                >
                                                    <Icon name="chevron-down" className="w-4 h-4 text-[#4c8ed9]" />
                                                    <span>Показати ще 50 записів (залишилось {mainFilteredList.length - displayLimit})</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setDisplayLimit(mainFilteredList.length)}
                                                    className="px-4 py-2 bg-[#101113] hover:bg-[#222429] border border-[#2e3138] text-[#b8bec8] hover:text-[#e6edf3] font-medium text-xs rounded-sm transition-colors cursor-pointer"
                                                >
                                                    <span>Показати всі ({mainFilteredList.length})</span>
                                                </button>
                                            </div>
                                        )}

                                        {/* Згорнутий блок попередніх записів в обліку (до дати відліку) */}
                                        {olderArchiveList.length > 0 && (
                                            <div className="pt-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowOlderArchive(prev => !prev)}
                                                    className="w-full py-2.5 px-4 bg-[#17181b] hover:bg-[#222429] border border-[#2e3138] hover:border-[#3c404a] rounded-sm flex items-center justify-between gap-3 text-xs text-[#e6edf3] transition-colors cursor-pointer group tabular-nums"
                                                >
                                                    <div className="flex items-center gap-2.5 flex-wrap text-left">
                                                        <Icon name="folder" className="w-4 h-4 text-[#4c8ed9] shrink-0" />
                                                        <span className="font-semibold text-[#e6edf3]">
                                                            Раніше в обліку (до {feedCutoffDate.split('-').reverse().join('.')})
                                                        </span>
                                                        <span className="px-2 py-0.5 rounded-sm bg-[#101113] border border-[#2e3138] text-[#e6edf3] font-mono font-bold text-[11px]">
                                                            {olderArchiveList.length} зап.
                                                        </span>
                                                        <span className="text-[11px] text-[#989fa9] hidden sm:inline">
                                                            • враховуються в загальній статистиці та черзі евакуації
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 text-[#4c8ed9] group-hover:text-[#e6edf3] font-semibold text-[11px] shrink-0">
                                                        <span>{showOlderArchive ? "Сховати старі записи" : "Показати старі записи"}</span>
                                                        <Icon name={showOlderArchive ? "chevron-up" : "chevron-down"} className="w-4 h-4" />
                                                    </div>
                                                </button>

                                                {showOlderArchive && (
                                                    <div className="mt-2.5 space-y-2.5 pl-2 sm:pl-3 border-l-2 border-[#2e3138]">
                                                        {olderArchiveList.map((episode) => (
                                                            <EpisodeCard 
                                                                key={episode.id} 
                                                                episode={episode} 
                                                                soldier={soldiersMap.get(episode.soldierId)} 
                                                                soldierEpisodes={episodesBySoldier.get(episode.soldierId) || EMPTY_EPISODES}
                                                                onEdit={handleStartEdit}
                                                                onNotify={triggerNotification}
                                                                viewMode="list" onReview={openChronology} clockTick={clockTick}
                                                            />
                                                        ))}
                                                    </div>
                                                )}
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
                                    <div className="w-full bg-[#17181b] border border-[#2e3138] rounded-sm p-3 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="flex items-center gap-2 font-semibold text-xs uppercase text-[#f3f4f6] font-mono tracking-wider">
                                            <Icon name="clipboard" className="w-4 h-4 text-[#4c8ed9]" />
                                            <span>Швидкі доповіді:</span>
                                        </div>

                                        <div className="flex items-center gap-2 flex-wrap">
                                            {/* Кнопка: Всі 300-ті */}
                                            <button 
                                                type="button" 
                                                onClick={() => copyGroupList(all300List, 'ЧЕРГА ЕВАКУАЦІЇ 300 (ПОРАНЕНІ)')}
                                                disabled={all300List.length === 0}
                                                className={`px-3 py-1.5 rounded-sm border flex items-center gap-2 text-xs font-medium transition-colors tabular-nums ${
                                                    all300List.length === 0
                                                        ? 'bg-[#101113] text-[#989fa9] border-[#2e3138] cursor-not-allowed opacity-50'
                                                        : 'bg-[#d99b26]/15 hover:bg-[#d99b26]/25 text-[#d99b26] border-[#d99b26]/50 cursor-pointer'
                                                }`}
                                                title="Скопіювати пронумерований список усіх поранених (Червона + Жовта + Зелена зони)"
                                            >
                                                <Icon name="activity" className="w-3.5 h-3.5 text-[#d99b26]" />
                                                <span>Скопіювати всіх 300-х ({all300List.length})</span>
                                            </button>

                                            {/* Кнопка: Всі 200-ті / ЗБВ */}
                                            <button 
                                                type="button" 
                                                onClick={() => copyGroupList(otherList, 'ЗАГИБЛІ ТА ЗБВ (ЧОРНА ЗОНА)')}
                                                disabled={otherList.length === 0}
                                                className={`px-3 py-1.5 rounded-sm border flex items-center gap-2 text-xs font-medium transition-colors tabular-nums ${
                                                    otherList.length === 0
                                                        ? 'bg-[#101113] text-[#989fa9] border-[#2e3138] cursor-not-allowed opacity-50'
                                                        : 'bg-[#222429] hover:bg-[#2e3138] text-[#f3f4f6] border-[#2e3138] hover:border-[#4c8ed9] cursor-pointer'
                                                }`}
                                                title="Скопіювати пронумерований список полеглих та ЗБВ на позиціях (Чорна зона)"
                                            >
                                                <Icon name="shield-alert" className="w-3.5 h-3.5 text-[#b8bec8]" />
                                                <span>Скопіювати всіх 200-х / ЗБВ ({otherList.length})</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* 4 ЗОНИ СОРТУВАННЯ */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5 items-start">
                                        
                                        {/* 1. ЧЕРВОНА ЗОНА */}
                                        <div className="bg-[#17181b] rounded-sm border border-[#d9534f]/50 flex flex-col min-h-[360px] overflow-hidden">
                                            <div className="p-3 border-b border-[#2e3138] bg-[#d9534f]/10 flex items-center justify-between">
                                                <div className="flex items-center gap-2 font-semibold text-[#f3a3a0] text-xs tracking-wider uppercase font-mono">
                                                    <div className="w-2 h-2 rounded-full bg-[#d9534f]"></div>
                                                    <span>ЧЕРВОНА ЗОНА</span>
                                                    <span className="bg-[#101113] text-[#f3a3a0] border border-[#d9534f]/40 px-1.5 py-0.5 rounded-sm font-mono text-[10px] font-semibold tabular-nums">
                                                        {critAndHeavyList.length}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    {critAndHeavyList.length > 0 && (
                                                        <button 
                                                            type="button" 
                                                            onClick={() => copyGroupList(critAndHeavyList, 'ЧЕРВОНА ЗОНА (КРИТИЧНІ / ВАЖКІ)')}
                                                            className="p-1 rounded-sm bg-[#101113] hover:bg-[#222429] text-[#f3a3a0] border border-[#2e3138] transition-colors cursor-pointer" 
                                                            title="Скопіювати список бійців Червоної зони"
                                                        >
                                                            <Icon name="copy" className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    <span className="text-[10px] text-[#f3a3a0] font-mono font-medium bg-[#101113] px-2 py-0.5 rounded-sm border border-[#2e3138]">
                                                        Критичні / Важкі
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="p-2.5 flex-1 overflow-y-auto space-y-2.5">
                                                {critAndHeavyList.map(renderTriageCard)}
                                                {critAndHeavyList.length === 0 && (
                                                    <div className="text-center text-[#989fa9] text-xs py-14 font-mono flex flex-col items-center gap-1.5">
                                                        <Icon name="shield-check" className="w-5 h-5 text-[#989fa9]" />
                                                        <span>Порожньо</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* 2. ЖОВТА ЗОНА */}
                                        <div className="bg-[#17181b] rounded-sm border border-[#d99b26]/50 flex flex-col min-h-[360px] overflow-hidden">
                                            <div className="p-3 border-b border-[#2e3138] bg-[#d99b26]/10 flex items-center justify-between">
                                                <div className="flex items-center gap-2 font-semibold text-[#d99b26] text-xs tracking-wider uppercase font-mono">
                                                    <div className="w-2 h-2 rounded-full bg-[#d99b26]"></div>
                                                    <span>ЖОВТА ЗОНА</span>
                                                    <span className="bg-[#101113] text-[#d99b26] border border-[#d99b26]/40 px-1.5 py-0.5 rounded-sm font-mono text-[10px] font-semibold tabular-nums">
                                                        {medList.length}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    {medList.length > 0 && (
                                                        <button 
                                                            type="button" 
                                                            onClick={() => copyGroupList(medList, 'ЖОВТА ЗОНА (СЕРЕДНІ)')}
                                                            className="p-1 rounded-sm bg-[#101113] hover:bg-[#222429] text-[#d99b26] border border-[#2e3138] transition-colors cursor-pointer" 
                                                            title="Скопіювати список бійців Жовтої зони"
                                                        >
                                                            <Icon name="copy" className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    <span className="text-[10px] text-[#d99b26] font-mono font-medium bg-[#101113] px-2 py-0.5 rounded-sm border border-[#2e3138]">
                                                        Середні
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="p-2.5 flex-1 overflow-y-auto space-y-2.5">
                                                {medList.map(renderTriageCard)}
                                                {medList.length === 0 && (
                                                    <div className="text-center text-[#989fa9] text-xs py-14 font-mono flex flex-col items-center gap-1.5">
                                                        <Icon name="shield-check" className="w-5 h-5 text-[#989fa9]" />
                                                        <span>Порожньо</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* 3. ЗЕЛЕНА ЗОНА */}
                                        <div className="bg-[#17181b] rounded-sm border border-[#3da372]/50 flex flex-col min-h-[360px] overflow-hidden">
                                            <div className="p-3 border-b border-[#2e3138] bg-[#3da372]/10 flex items-center justify-between">
                                                <div className="flex items-center gap-2 font-semibold text-[#3da372] text-xs tracking-wider uppercase font-mono">
                                                    <div className="w-2 h-2 rounded-full bg-[#3da372]"></div>
                                                    <span>ЗЕЛЕНА ЗОНА</span>
                                                    <span className="bg-[#101113] text-[#3da372] border border-[#3da372]/40 px-1.5 py-0.5 rounded-sm font-mono text-[10px] font-semibold tabular-nums">
                                                        {lightList.length}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    {lightList.length > 0 && (
                                                        <button 
                                                            type="button" 
                                                            onClick={() => copyGroupList(lightList, 'ЗЕЛЕНА ЗОНА (ЛЕГКІ)')}
                                                            className="p-1 rounded-sm bg-[#101113] hover:bg-[#222429] text-[#3da372] border border-[#2e3138] transition-colors cursor-pointer" 
                                                            title="Скопіювати список бійців Зеленої зони"
                                                        >
                                                            <Icon name="copy" className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    <span className="text-[10px] text-[#3da372] font-mono font-medium bg-[#101113] px-2 py-0.5 rounded-sm border border-[#2e3138]">
                                                        Легкі
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="p-2.5 flex-1 overflow-y-auto space-y-2.5">
                                                {lightList.map(renderTriageCard)}
                                                {lightList.length === 0 && (
                                                    <div className="text-center text-[#989fa9] text-xs py-14 font-mono flex flex-col items-center gap-1.5">
                                                        <Icon name="shield-check" className="w-5 h-5 text-[#989fa9]" />
                                                        <span>Порожньо</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* 4. ЧОРНА ЗОНА */}
                                        <div className="bg-[#17181b] rounded-sm border border-[#2e3138] flex flex-col min-h-[360px] overflow-hidden">
                                            <div className="p-3 border-b border-[#2e3138] bg-[#101113] flex items-center justify-between">
                                                <div className="flex items-center gap-2 font-semibold text-[#b8bec8] text-xs tracking-wider uppercase font-mono">
                                                    <div className="w-2 h-2 rounded-full bg-[#989fa9]"></div>
                                                    <span>ЧОРНА ЗОНА</span>
                                                    <span className="bg-[#17181b] text-[#f3f4f6] border border-[#2e3138] px-1.5 py-0.5 rounded-sm font-mono text-[10px] font-semibold tabular-nums">
                                                        {otherList.length}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    {otherList.length > 0 && (
                                                        <button 
                                                            type="button" 
                                                            onClick={() => copyGroupList(otherList, 'ЧОРНА ЗОНА (ЗАГИБЛІ / ЗБВ)')}
                                                            className="p-1 rounded-sm bg-[#17181b] hover:bg-[#222429] text-[#f3f4f6] border border-[#2e3138] transition-colors cursor-pointer" 
                                                            title="Скопіювати список полеглих та ЗБВ Чорної зони"
                                                        >
                                                            <Icon name="copy" className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    <span className="text-[10px] text-[#b8bec8] font-mono font-medium bg-[#17181b] border border-[#2e3138] px-2 py-0.5 rounded-sm">
                                                        200 / ЗБВ
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="p-2.5 flex-1 overflow-y-auto space-y-2.5">
                                                {otherList.map(renderTriageCard)}
                                                {otherList.length === 0 && (
                                                    <div className="text-center text-[#989fa9] text-xs py-14 font-mono flex flex-col items-center gap-1.5">
                                                        <Icon name="shield-check" className="w-5 h-5 text-[#989fa9]" />
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
                                <div className="w-full bg-[#17181b] border border-[#2e3138] rounded-sm p-3 flex items-center justify-between gap-3 flex-wrap">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <div className="flex items-center gap-1.5 font-bold text-xs uppercase text-[#4c8ed9] font-mono tracking-wider">
                                            <Icon name="bar-chart-2" className="w-4 h-4 text-[#4c8ed9]" />
                                            <span>Аналітика:</span>
                                        </div>

                                        {/* Швидкі пресети періоду дат */}
                                        <div className="flex items-center bg-[#101113] p-1 rounded-sm border border-[#2e3138] text-xs font-medium tabular-nums">
                                            <button 
                                                type="button" 
                                                onClick={() => applyAnDatePreset('all')} 
                                                className={`px-2.5 py-1 rounded-sm transition-colors cursor-pointer select-none border ${anDatePreset === 'all' ? 'bg-[#4c8ed9]/15 text-[#e6edf3] font-bold border-[#4c8ed9]/50' : 'border-transparent text-[#b8bec8] hover:text-[#e6edf3] hover:bg-[#222429]'}`}
                                            >
                                                Всі дати
                                            </button>
                                            <button 
                                                type="button" 
                                                onClick={() => applyAnDatePreset('1')} 
                                                className={`px-2.5 py-1 rounded-sm transition-colors cursor-pointer select-none border ${anDatePreset === '1' ? 'bg-[#4c8ed9]/15 text-[#e6edf3] font-bold border-[#4c8ed9]/50' : 'border-transparent text-[#b8bec8] hover:text-[#e6edf3] hover:bg-[#222429]'}`}
                                            >
                                                За добу
                                            </button>
                                            <button 
                                                type="button" 
                                                onClick={() => applyAnDatePreset('3')} 
                                                className={`px-2.5 py-1 rounded-sm transition-colors cursor-pointer select-none border ${anDatePreset === '3' ? 'bg-[#4c8ed9]/15 text-[#e6edf3] font-bold border-[#4c8ed9]/50' : 'border-transparent text-[#b8bec8] hover:text-[#e6edf3] hover:bg-[#222429]'}`}
                                            >
                                                3 дні
                                            </button>
                                            <button 
                                                type="button" 
                                                onClick={() => applyAnDatePreset('7')} 
                                                className={`px-2.5 py-1 rounded-sm transition-colors cursor-pointer select-none border ${anDatePreset === '7' ? 'bg-[#4c8ed9]/15 text-[#e6edf3] font-bold border-[#4c8ed9]/50' : 'border-transparent text-[#b8bec8] hover:text-[#e6edf3] hover:bg-[#222429]'}`}
                                            >
                                                7 днів
                                            </button>

                                            {/* Точний період (календар-поповер) */}
                                            <div className="relative">
                                                <button 
                                                    type="button" 
                                                    onClick={() => setOpenDropdown(openDropdown === 'an_custom_date' ? null : 'an_custom_date')} 
                                                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm transition-colors cursor-pointer select-none border ${anDatePreset === 'custom' ? 'bg-[#4c8ed9]/15 text-[#e6edf3] font-bold border-[#4c8ed9]/50' : 'border-transparent text-[#b8bec8] hover:text-[#e6edf3] hover:bg-[#222429]'}`}
                                                    title="Вибрати точний період дат у календарі"
                                                >
                                                    <Icon name="calendar" className="w-3.5 h-3.5 text-[#4c8ed9]" />
                                                    <span className="font-mono">{anDatePreset === 'custom' && anDateFrom ? `${anDateFrom.slice(5)} — ${anDateTo ? anDateTo.slice(5) : '...'}` : 'Календар'}</span>
                                                    <Icon name="chevron-down" className="w-2.5 h-2.5 text-[#989fa9]" />
                                                </button>
                                                {openDropdown === 'an_custom_date' && (
                                                    <>
                                                        <div className="fixed inset-0 z-40 cursor-default" onClick={() => setOpenDropdown(null)}></div>
                                                        <div className="absolute left-0 top-full mt-1.5 z-50 bg-[#17181b] border border-[#2e3138] rounded-sm p-4 w-72 space-y-3.5 font-sans">
                                                            <div className="flex justify-between items-center pb-2 border-b border-[#2e3138]">
                                                                <span className="text-xs font-bold text-[#e6edf3] flex items-center gap-1.5">
                                                                    <Icon name="calendar" className="w-4 h-4 text-[#4c8ed9]" />
                                                                    <span>Період аналітики</span>
                                                                </span>
                                                                <button 
                                                                    type="button" 
                                                                    onClick={() => { applyAnDatePreset('all'); setOpenDropdown(null); }} 
                                                                    className="text-[10px] text-[#4c8ed9] hover:text-[#e6edf3] font-semibold cursor-pointer"
                                                                >
                                                                    Скинути
                                                                </button>
                                                            </div>
                                                            <div className="space-y-2.5 text-xs">
                                                                <div>
                                                                    <span className="text-[10px] font-bold text-[#b8bec8] uppercase font-mono block mb-1">Від дати:</span>
                                                                    <input 
                                                                        type="date" 
                                                                        value={anDateFrom} 
                                                                        onChange={(e) => { setAnDateFrom(e.target.value); setAnDatePreset('custom'); }} 
                                                                        className="w-full bg-[#101113] border border-[#2e3138] rounded-sm px-2.5 py-1.5 text-xs text-[#e6edf3] focus:border-[#4c8ed9] outline-none font-mono" 
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <span className="text-[10px] font-bold text-[#b8bec8] uppercase font-mono block mb-1">До дати:</span>
                                                                    <input 
                                                                        type="date" 
                                                                        value={anDateTo} 
                                                                        onChange={(e) => { setAnDateTo(e.target.value); setAnDatePreset('custom'); }} 
                                                                        className="w-full bg-[#101113] border border-[#2e3138] rounded-sm px-2.5 py-1.5 text-xs text-[#e6edf3] focus:border-[#4c8ed9] outline-none font-mono" 
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className="pt-2 border-t border-[#2e3138] flex justify-end">
                                                                <button 
                                                                    type="button" 
                                                                    onClick={() => setOpenDropdown(null)} 
                                                                    className="w-full py-1.5 bg-[#2b67ab] hover:bg-[#3678c4] border border-[#4c8ed9] text-white font-semibold text-xs rounded-sm transition-colors cursor-pointer text-center"
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
                                        <div className="flex items-center gap-1.5 bg-[#101113] px-3 py-1.5 rounded-sm border border-[#2e3138] text-xs">
                                            <span className="text-[#b8bec8] font-mono text-[10px] uppercase">УПД:</span>
                                            <select value={anUdp} onChange={(e) => setAnUdp(e.target.value)} className="bg-transparent text-[#e6edf3] focus:outline-none cursor-pointer text-xs font-medium">
                                                <option value="all">Всі випадки</option>
                                                <option value="yes">Тільки під час УПД</option>
                                                <option value="no">Без УПД</option>
                                            </select>
                                        </div>

                                        {/* Глибокий фільтр: Сектор / Позиція */}
                                        <div className="flex items-center gap-1.5 bg-[#101113] px-2.5 py-1.5 rounded-sm border border-[#2e3138] text-xs tabular-nums">
                                            <Icon name="map-pin" className="w-3.5 h-3.5 text-[#4c8ed9] shrink-0" />
                                            <span className="text-[#b8bec8] font-mono text-[10px] uppercase hidden sm:inline">Сектор:</span>
                                            <select 
                                                value={anSector} 
                                                onChange={(e) => setAnSector(e.target.value)} 
                                                className="bg-transparent text-[#e6edf3] focus:outline-none cursor-pointer text-xs font-semibold max-w-[180px] truncate"
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
                                                    className="text-[#989fa9] hover:text-[#f3a3a0] transition-colors ml-0.5 cursor-pointer" 
                                                    title="Скинути фільтр сектора"
                                                >
                                                    <Icon name="x" className="w-3 h-3" />
                                                </button>
                                            )}
                                        </div>

                                        {/* Відбір актуальних епізодів */}
                                        <label className="flex items-center gap-1.5 cursor-pointer bg-[#101113] px-2.5 py-1.5 rounded-sm border border-[#2e3138] text-[#b8bec8] hover:text-[#e6edf3] text-xs select-none" title="Показувати тільки останній стан бійця">
                                            <input type="checkbox" checked={anShowLatest} onChange={(e) => setAnShowLatest(e.target.checked)} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#4c8ed9] focus:ring-0 w-3.5 h-3.5 cursor-pointer shrink-0"/>
                                            <span className="font-medium text-[11px]">Тільки актуальні</span>
                                        </label>

                                        <label className="flex items-center gap-1.5 cursor-pointer bg-[#101113] px-2.5 py-1.5 rounded-sm border border-[#2e3138] text-[#b8bec8] hover:text-[#e6edf3] text-xs select-none" title="Об&apos;єднати групи: 200+ЗБВ та Поранення+Бойові травми">
                                            <input type="checkbox" checked={groupAnalytics} onChange={(e) => setGroupAnalytics(e.target.checked)} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#4c8ed9] focus:ring-0 w-3.5 h-3.5 cursor-pointer shrink-0"/>
                                            <span className="font-medium text-[11px]">Об&apos;єднати групи</span>
                                        </label>
                                    </div>

                                    <div className="flex items-center gap-2 flex-wrap">
                                        <button
                                            type="button"
                                            onClick={handleOpenPrintableReport}
                                            className="px-3 py-1.5 bg-[#8f5fb8]/15 hover:bg-[#8f5fb8]/25 text-[#d8b4fe] font-semibold border border-[#8f5fb8]/50 rounded-sm transition-colors flex items-center gap-1.5 text-xs cursor-pointer select-none"
                                            title="Згенерувати офіційне бойове донесення у форматі A4 для друку або збереження в PDF"
                                        >
                                            <Icon name="printer" className="w-3.5 h-3.5 text-[#c084fc]" />
                                            <span>Доповідь (A4 / PDF)</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleExportAnalyticsText}
                                            className="px-3 py-1.5 bg-[#4c8ed9]/15 hover:bg-[#4c8ed9]/25 text-[#9bc5f4] font-semibold border border-[#4c8ed9]/50 rounded-sm transition-colors flex items-center gap-1.5 text-xs cursor-pointer select-none"
                                            title="Згенерувати текстовий звіт в буфер обміну"
                                        >
                                            <Icon name="file-text" className="w-3.5 h-3.5 text-[#4c8ed9]" />
                                            <span>Звіт (Текст)</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleExportAnalyticsExcel}
                                            className="px-3 py-1.5 bg-[#3da372]/15 hover:bg-[#3da372]/25 text-[#8ad8ae] font-semibold border border-[#3da372]/50 rounded-sm transition-colors flex items-center gap-1.5 text-xs cursor-pointer select-none"
                                            title="Експорт аналітики: 6 аркушів Excel"
                                        >
                                            <Icon name="table" className="w-3.5 h-3.5 text-[#3da372]" />
                                            <span>Експорт (Excel)</span>
                                        </button>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={resetAnalyticsFilters}
                                        className="px-3 py-1.5 bg-[#101113] hover:bg-[#222429] text-[#b8bec8] hover:text-[#e6edf3] text-xs font-semibold rounded-sm border border-[#2e3138] hover:border-[#3c404a] transition-colors cursor-pointer flex items-center gap-1.5 select-none"
                                        title="Скинути параметри аналітики"
                                    >
                                        <Icon name="rotate-ccw" className="w-3.5 h-3.5" />
                                        <span>Скинути</span>
                                    </button>
                                </div>
                                <div className="bg-[#17181b] border border-[#2e3138] rounded-sm p-2.5 px-4 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-10">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-[10px] text-[#b8bec8] font-bold uppercase mr-1 flex items-center gap-1"><Icon name="eye" className="w-3.5 h-3.5 text-[#b8bec8]" /> Відображати:</span>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-[#e6edf3] text-xs font-semibold bg-[#101113] px-2 py-1 rounded-sm border border-[#2e3138] hover:border-[#3c404a]"><input type="checkbox" checked={dynFilters.show200} onChange={e => setDynFilters(p => ({...p, show200: e.target.checked}))} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#b8bec8] focus:ring-0 w-3.5 h-3.5"/> Бойові 200</label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-[#b8bec8] text-xs font-semibold bg-[#101113] px-2 py-1 rounded-sm border border-[#2e3138] hover:text-[#e6edf3]"><input type="checkbox" checked={dynFilters.show200pvr} onChange={e => setDynFilters(p => ({...p, show200pvr: e.target.checked}))} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#b8bec8] focus:ring-0 w-3.5 h-3.5"/> 200 (ПВР)</label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-[#b8bec8] text-xs font-semibold bg-[#101113] px-2 py-1 rounded-sm border border-[#2e3138] hover:text-[#e6edf3]"><input type="checkbox" checked={dynFilters.showNonCombatDead} onChange={e => setDynFilters(p => ({...p, showNonCombatDead: e.target.checked}))} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#b8bec8] focus:ring-0 w-3.5 h-3.5"/> Небойові 200</label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-[#f3a3a0] text-xs font-semibold bg-[#101113] px-2 py-1 rounded-sm border border-[#2e3138] hover:border-[#3c404a]"><input type="checkbox" checked={dynFilters.showWound} onChange={e => setDynFilters(p => ({...p, showWound: e.target.checked}))} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#d9534f] focus:ring-0 w-3.5 h-3.5"/> Поранення</label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-[#e7c574] text-xs font-semibold bg-[#101113] px-2 py-1 rounded-sm border border-[#2e3138] hover:border-[#3c404a]"><input type="checkbox" checked={dynFilters.showCombatTr} onChange={e => setDynFilters(p => ({...p, showCombatTr: e.target.checked}))} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#d99b26] focus:ring-0 w-3.5 h-3.5"/> Бойові тр.</label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-[#facc15] text-xs font-semibold bg-[#101113] px-2 py-1 rounded-sm border border-[#2e3138] hover:border-[#3c404a]"><input type="checkbox" checked={dynFilters.showNonCombatTr} onChange={e => setDynFilters(p => ({...p, showNonCombatTr: e.target.checked}))} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#d99b26] focus:ring-0 w-3.5 h-3.5"/> Небойові тр.</label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-[#9fc5ef] text-xs font-semibold bg-[#101113] px-2 py-1 rounded-sm border border-[#2e3138] hover:border-[#3c404a]"><input type="checkbox" checked={dynFilters.showMIA} onChange={e => setDynFilters(p => ({...p, showMIA: e.target.checked}))} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#4c8ed9] focus:ring-0 w-3.5 h-3.5"/> ЗБВ</label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-[#d8b4fe] text-xs font-semibold bg-[#101113] px-2 py-1 rounded-sm border border-[#2e3138] hover:border-[#3c404a]"><input type="checkbox" checked={dynFilters.showAWOL} onChange={e => setDynFilters(p => ({...p, showAWOL: e.target.checked}))} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#8f5fb8] focus:ring-0 w-3.5 h-3.5"/> СЗЧ / Дезерт.</label>
                                    </div>
                                    
                                    <div className="flex items-center gap-2 border-l border-[#2e3138] pl-3">
                                        <label title={window.ChartDataLabels ? 'Показати значення на діаграмах' : 'Не завантажено бібліотеку підписів. Перевірте Інтернет і перезавантажте програму.'} className="flex items-center gap-1.5 cursor-pointer select-none text-[#8ad8ae] text-xs font-semibold bg-[#101113] px-2 py-1 rounded-sm border border-[#2e3138]"><input type="checkbox" checked={showChartLabels} disabled={!window.ChartDataLabels} onChange={e => setShowChartLabels(e.target.checked)} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#3da372] focus:ring-0 w-3.5 h-3.5 disabled:opacity-50"/> Цифри</label>
                                        <label className={`flex items-center gap-1.5 cursor-pointer select-none text-xs font-semibold bg-[#101113] px-2 py-1 rounded-sm border border-[#2e3138] ${showChartLabels ? 'text-[#8ad8ae]' : 'text-[#989fa9]'}`}><input type="checkbox" checked={showChartPercentages} onChange={e => setShowChartPercentages(e.target.checked)} disabled={!showChartLabels} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#3da372] focus:ring-0 w-3.5 h-3.5 disabled:opacity-50"/> у %</label>
                                    </div>
                                </div>

                                <p className="text-xs text-[#b8bec8]">Галочки вище фільтрують усі показники евакуації та діаграми аналітики.</p>
                                <div className="medical-charts-grid grid grid-cols-1 lg:grid-cols-12 gap-5 tabular-nums">
                                    <div className="bg-[#17181b] border border-[#2e3138] rounded-sm p-4 lg:col-span-6 flex flex-col">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-1.5 bg-[#101113] border border-[#2e3138] rounded-sm"><Icon name="timer" className="w-4 h-4 text-[#4c8ed9]" /></div>
                                            <h3 className="font-bold text-[#e6edf3] text-sm">Середній час евакуації (у днях)</h3>
                                        </div>
                                        <ChartComponent 
                                            title="Середній_час_евакуації" showLabels={showChartLabels} showPercentages={false}
                                            className="flex-1 min-h-[250px] w-full relative" type="bar"
                                            data={chartData.evacChartDataConfig}
                                            options={{ plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: '#2e3138' }, title: { display: true, text: 'Дні', color: '#b8bec8' } } } }}
                                        />
                                    </div>

                                    <div className="bg-[#17181b] border border-[#2e3138] rounded-sm p-4 lg:col-span-6 flex flex-col relative overflow-hidden">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-1.5 bg-[#101113] border border-[#2e3138] rounded-sm"><Icon name="truck" className="w-4 h-4 text-[#4c8ed9]" /></div>
                                            <h3 className="font-bold text-[#e6edf3] text-sm">Розширений звіт з евакуації за період</h3>
                                        </div>
                                        
                                        <div className="grid grid-cols-2 gap-3 flex-1">
                                            <div className="bg-[#101113] rounded-sm p-4 border border-[#2e3138] flex flex-col justify-center">
                                                <div className="text-[10px] text-[#b8bec8] font-bold uppercase mb-1">Фактично евакуйовано</div>
                                                <div className="text-4xl font-bold text-[#4c8ed9] mb-2 font-mono">{evacStats.actualEvacTotal}</div>
                                                <div className="space-y-1.5 text-[11px] text-[#b8bec8] border-t border-[#2e3138] pt-2">
                                                    <div className="flex justify-between" title="Поранені та евакуйовані в цьому ж періоді">
                                                        <span>З цього періоду:</span>
                                                        <span className="font-bold font-mono text-[#c5ddf8]">
                                                            {(dynFilters.showWound || dynFilters.showCombatTr || dynFilters.showNonCombatTr) && (dynFilters.show200 || dynFilters.show200pvr || dynFilters.showNonCombatDead)
                                                                ? `300: ${evacStats.evacPeriod300} / 200: ${evacStats.evacPeriod200}`
                                                                : (dynFilters.showWound || dynFilters.showCombatTr || dynFilters.showNonCombatTr)
                                                                    ? `300: ${evacStats.evacPeriod300}`
                                                                    : (dynFilters.show200 || dynFilters.show200pvr || dynFilters.showNonCombatDead)
                                                                        ? `200: ${evacStats.evacPeriod200}`
                                                                        : '0'}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between" title="Евакуйовані зараз, але поранені раніше">
                                                        <span>З минулих періодів:</span>
                                                        <span className="font-bold font-mono text-[#c5ddf8]">
                                                            {(dynFilters.showWound || dynFilters.showCombatTr || dynFilters.showNonCombatTr) && (dynFilters.show200 || dynFilters.show200pvr || dynFilters.showNonCombatDead)
                                                                ? `300: ${evacStats.evacBefore300} / 200: ${evacStats.evacBefore200}`
                                                                : (dynFilters.showWound || dynFilters.showCombatTr || dynFilters.showNonCombatTr)
                                                                    ? `300: ${evacStats.evacBefore300}`
                                                                    : (dynFilters.show200 || dynFilters.show200pvr || dynFilters.showNonCombatDead)
                                                                        ? `200: ${evacStats.evacBefore200}`
                                                                        : '0'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="bg-[#101113] rounded-sm p-4 border border-[#2e3138] flex flex-col justify-center relative">
                                                <div className="absolute top-4 right-4 text-right">
                                                    <div className="text-[10px] font-bold text-[#989fa9] uppercase">Успішність</div>
                                                    <div className={`text-lg font-bold font-mono ${evacStats.evacSuccessRate > 50 ? 'text-[#3da372]' : 'text-[#d9534f]'}`}>{evacStats.evacSuccessRate}%</div>
                                                </div>
                                                <div className="text-[10px] text-[#b8bec8] font-bold uppercase mb-1">Втрати цього періоду</div>
                                                <div className="text-2xl font-bold text-[#e6edf3] mb-2 font-mono">Всього: {evacStats.totalPeriod300 + evacStats.totalPeriod200}</div>
                                                <div className="space-y-1.5 text-[11px] text-[#b8bec8] border-t border-[#2e3138] pt-2">
                                                    <div className="flex justify-between" title="Вже вивезені">
                                                        <span>Вже евакуйовано:</span>
                                                        <span className="font-bold font-mono text-[#8ad8ae]">
                                                            {(dynFilters.showWound || dynFilters.showCombatTr || dynFilters.showNonCombatTr) && (dynFilters.show200 || dynFilters.show200pvr || dynFilters.showNonCombatDead)
                                                                ? `300: ${evacStats.periodEvacuated300} / 200: ${evacStats.periodEvacuated200}`
                                                                : (dynFilters.showWound || dynFilters.showCombatTr || dynFilters.showNonCombatTr)
                                                                    ? `300: ${evacStats.periodEvacuated300}`
                                                                    : (dynFilters.show200 || dynFilters.show200pvr || dynFilters.showNonCombatDead)
                                                                        ? `200: ${evacStats.periodEvacuated200}`
                                                                        : '0'}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between" title="Все ще чекають">
                                                        <span>Очікують евакуації:</span>
                                                        <span className="font-bold font-mono text-[#f3a3a0]">
                                                            {(dynFilters.showWound || dynFilters.showCombatTr || dynFilters.showNonCombatTr) && (dynFilters.show200 || dynFilters.show200pvr || dynFilters.showNonCombatDead)
                                                                ? `300: ${evacStats.periodWaiting300} / 200: ${evacStats.periodWaiting200}`
                                                                : (dynFilters.showWound || dynFilters.showCombatTr || dynFilters.showNonCombatTr)
                                                                    ? `300: ${evacStats.periodWaiting300}`
                                                                    : (dynFilters.show200 || dynFilters.show200pvr || dynFilters.showNonCombatDead)
                                                                        ? `200: ${evacStats.periodWaiting200}`
                                                                        : '0'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="bg-[#d9534f]/10 rounded-sm p-4 border border-[#d9534f]/40 col-span-2 flex justify-between items-center">
                                                <div>
                                                    <div className="text-[11px] text-[#f3a3a0] font-bold uppercase mb-1 flex items-center gap-1.5"><Icon name="alert-triangle" className="w-3.5 h-3.5 text-[#d9534f]"/> Глобальна черга на евакуацію</div>
                                                    <div className="text-[10px] text-[#b8bec8]">Всі, хто залишався неевакуйованим на момент кінця вказаного періоду.</div>
                                                </div>
                                                <div className="text-right border-l border-[#d9534f]/30 pl-4 font-mono">
                                                    {(dynFilters.showWound || dynFilters.showCombatTr || dynFilters.showNonCombatTr) && (
                                                        <div className="font-bold text-[#e6edf3] text-sm whitespace-nowrap mb-0.5">300: <span className="text-[#f3a3a0] text-lg">{evacStats.globalWaiting300}</span> <span className="text-[9px] text-[#b8bec8] font-normal font-sans">({evacStats.globalWaitingCritHeavy} важкі)</span></div>
                                                    )}
                                                    <div className="font-bold text-[#e6edf3] text-sm whitespace-nowrap flex items-center justify-end gap-2">
                                                        {(dynFilters.show200 || dynFilters.show200pvr || dynFilters.showNonCombatDead) && (
                                                            <span>200: <span className="text-[#e6edf3] text-lg">{evacStats.globalWaiting200}</span></span>
                                                        )}
                                                        {!groupAnalytics && dynFilters.showMIA && evacStats.globalWaitingMia > 0 && (
                                                            <span className="text-[#9fc5ef] font-semibold text-xs ml-1">/ ЗБВ: <span className="text-[#c5ddf8] text-base font-bold">{evacStats.globalWaitingMia}</span></span>
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
                                    <div className="bg-[#17181b] border border-[#2e3138] rounded-sm p-4 lg:col-span-8 flex flex-col overflow-hidden">
                                        <div className="flex items-center gap-2 mb-4 shrink-0">
                                            <div className="p-1.5 bg-[#101113] border border-[#2e3138] rounded-sm"><Icon name="map-pin" className="w-4 h-4 text-[#b8bec8]" /></div>
                                            <h3 className="font-bold text-[#e6edf3] text-sm">Фактичне місце (за статусом втрат)</h3>
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
                                                            { label: '200 (ПВР)', data: chartData.actLocs.labels.map(l => chartData.actLocs.data[l]['200 ПВР']), backgroundColor: '#4b5563' },
                                                            { label: 'Небойові 200', data: chartData.actLocs.labels.map(l => chartData.actLocs.data[l]['Неб. смерть']), backgroundColor: '#57534e' },
                                                            { label: 'Поранення', data: chartData.actLocs.labels.map(l => chartData.actLocs.data[l]['Поранення']), backgroundColor: '#ef4444' },
                                                            { label: 'Бойові', data: chartData.actLocs.labels.map(l => chartData.actLocs.data[l]['Бойове']), backgroundColor: '#f59e0b' },
                                                            { label: 'Небойові', data: chartData.actLocs.labels.map(l => chartData.actLocs.data[l]['Небойове']), backgroundColor: '#fde047' },
                                                            { label: 'ЗБВ', data: chartData.actLocs.labels.map(l => chartData.actLocs.data[l]['ЗБВ']), backgroundColor: '#3b82f6' },
                                                            { label: 'СЗЧ', data: chartData.actLocs.labels.map(l => chartData.actLocs.data[l]['СЗЧ']), backgroundColor: '#c026d3' },
                                                            { label: 'Дезертирство', data: chartData.actLocs.labels.map(l => chartData.actLocs.data[l]['Дезертирство']), backgroundColor: '#db2777' }
                                                        ]
                                                    }}
                                                    options={{ indexAxis: 'y', plugins: { legend: { position: 'top' }, tooltip: { mode: 'index', axis: 'y', intersect: false } }, scales: { x: { stacked: true, grid: { color: '#2e3138' }, ticks: { precision: 0 } }, y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false } } } }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bg-[#17181b] border border-[#2e3138] rounded-sm p-4 lg:col-span-4 flex flex-col">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-1.5 bg-[#101113] border border-[#2e3138] rounded-sm"><Icon name="pie-chart" className="w-4 h-4 text-[#d9534f]" /></div>
                                            <h3 className="font-bold text-[#e6edf3] text-sm">Структура втрат</h3>
                                        </div>
                                        <ChartComponent 
                                            title="Структура_втрат" showLabels={showChartLabels} showPercentages={showChartPercentages}
                                            className="flex-1 min-h-[250px] w-full relative flex items-center justify-center" type="doughnut"
                                            data={{
                                                labels: [
                                                    ...(dynFilters.show200 ? ['Бойові 200'] : []), ...(dynFilters.show200pvr ? ['200 (ПВР)'] : []), ...(dynFilters.showNonCombatDead ? ['Небойові 200'] : []),
                                                    ...(dynFilters.showWound ? ['Поранення'] : []), ...(dynFilters.showCombatTr ? ['Бойові тр.'] : []), 
                                                    ...(dynFilters.showNonCombatTr ? ['Небойові тр.'] : []), ...(dynFilters.showMIA ? ['ЗБВ'] : []), 
                                                    ...(dynFilters.showAWOL ? ['СЗЧ', 'Дезертирство'] : [])
                                                ],
                                                datasets: [{
                                                    data: [
                                                        ...(dynFilters.show200 ? [chartData.types.c200] : []), ...(dynFilters.show200pvr ? [chartData.types.c200pvr] : []), ...(dynFilters.showNonCombatDead ? [chartData.types.c200nc] : []),
                                                        ...(dynFilters.showWound ? [chartData.types.cWound] : []), ...(dynFilters.showCombatTr ? [chartData.types.cCombat] : []), 
                                                        ...(dynFilters.showNonCombatTr ? [chartData.types.cNonCombat] : []), ...(dynFilters.showMIA ? [chartData.types.cMia] : []), 
                                                        ...(dynFilters.showAWOL ? [chartData.types.cAwol, chartData.types.cDesert] : [])
                                                    ],
                                                    backgroundColor: [
                                                        ...(dynFilters.show200 ? ['#71717a'] : []), ...(dynFilters.show200pvr ? ['#4b5563'] : []), ...(dynFilters.showNonCombatDead ? ['#57534e'] : []),
                                                        ...(dynFilters.showWound ? ['#ef4444'] : []), ...(dynFilters.showCombatTr ? ['#f59e0b'] : []), 
                                                        ...(dynFilters.showNonCombatTr ? ['#fde047'] : []), ...(dynFilters.showMIA ? ['#3b82f6'] : []), 
                                                        ...(dynFilters.showAWOL ? ['#c026d3', '#db2777'] : [])
                                                    ],
                                                    borderColor: '#17181b', borderWidth: 2, hoverOffset: 4
                                                }]
                                            }}
                                            options={{ cutout: '70%', plugins: { legend: { position: 'bottom', labels: { color: '#b8bec8' } } } }}
                                        />
                                    </div>

                                    {/* ПАРА 2: Локації (Важкість) + Важкість */}
                                    <div className="bg-[#17181b] border border-[#2e3138] rounded-sm p-4 lg:col-span-8 flex flex-col overflow-hidden">
                                        <div className="flex items-center gap-2 mb-4 shrink-0">
                                            <div className="p-1.5 bg-[#101113] border border-[#2e3138] rounded-sm"><Icon name="activity" className="w-4 h-4 text-[#d99b26]" /></div>
                                            <h3 className="font-bold text-[#e6edf3] text-sm">Фактичне місце (за важкістю 300-х)</h3>
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
                                                    options={{ indexAxis: 'y', plugins: { legend: { position: 'top' }, tooltip: { mode: 'index', axis: 'y', intersect: false } }, scales: { x: { stacked: true, grid: { color: '#2e3138' }, ticks: { precision: 0 } }, y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false } } } }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bg-[#17181b] border border-[#2e3138] rounded-sm p-4 lg:col-span-4 flex flex-col">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-1.5 bg-[#101113] border border-[#2e3138] rounded-sm"><Icon name="heart-pulse" className="w-4 h-4 text-[#c084fc]" /></div>
                                            <h3 className="font-bold text-[#e6edf3] text-sm">Важкість (Всі 300-ті)</h3>
                                        </div>
                                        <ChartComponent 
                                            title="Важкість" showLabels={showChartLabels} showPercentages={showChartPercentages}
                                            className="flex-1 min-h-[250px] w-full relative flex items-center justify-center" type="doughnut"
                                            data={{
                                                labels: Object.keys(chartData.severity),
                                                datasets: [{ 
                                                    data: Object.values(chartData.severity), 
                                                    backgroundColor: Object.keys(chartData.severity).map(k => SEVERITY_COLORS[k] || '#6b7280'), 
                                                    borderColor: '#17181b', 
                                                    borderWidth: 2 
                                                }]
                                            }}
                                            options={{ cutout: '70%', plugins: { legend: { position: 'bottom', labels: { color: '#b8bec8' } } } }}
                                        />
                                    </div>

                                    {/* ПАРА 3: Локації (Причини) + Причини (Бублик) */}
                                    <div className="bg-[#17181b] border border-[#2e3138] rounded-sm p-4 lg:col-span-8 flex flex-col overflow-hidden">
                                        <div className="flex items-center gap-2 mb-4 shrink-0">
                                            <div className="p-1.5 bg-[#101113] border border-[#2e3138] rounded-sm"><Icon name="crosshair" className="w-4 h-4 text-[#d9534f]" /></div>
                                            <h3 className="font-bold text-[#e6edf3] text-sm">Фактичне місце (за зброєю / причиною ураження)</h3>
                                        </div>
                                        <div className="overflow-y-auto pr-2">
                                            <div style={{ height: `${locChartHeight}px` }} className="w-full relative">
                                                <ChartComponent 
                                                    title="Локації_за_причинами" showLabels={showChartLabels} showPercentages={showChartPercentages}
                                                    className="w-full h-full" type="bar"
                                                    data={chartData.locCause}
                                                    options={{ indexAxis: 'y', plugins: { legend: { position: 'top', labels: { boxWidth: 12, padding: 15 } }, tooltip: { mode: 'index', axis: 'y', intersect: false } }, scales: { x: { stacked: true, grid: { color: '#2e3138' }, ticks: { precision: 0 } }, y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false } } } }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bg-[#17181b] border border-[#2e3138] rounded-sm p-4 lg:col-span-4 flex flex-col">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-1.5 bg-[#101113] border border-[#2e3138] rounded-sm"><Icon name="zap" className="w-4 h-4 text-[#d99b26]" /></div>
                                            <h3 className="font-bold text-[#e6edf3] text-sm">Причини подій</h3>
                                        </div>
                                        <ChartComponent 
                                            title="Причини_подій" showLabels={showChartLabels} showPercentages={showChartPercentages}
                                            className="flex-1 min-h-[250px] w-full relative flex items-center justify-center" type="doughnut"
                                            data={{
                                                labels: chartData.reasons.labels,
                                                datasets: [{
                                                    data: chartData.reasons.labels.map(r => {
                                                        const d = chartData.reasons.data[r];
                                                        return d['200'] + d['200 ПВР'] + d['Неб. смерть'] + d['Поранення'] + d['Бойове'] + d['Небойове'] + d['ЗБВ'] + d['СЗЧ'] + d['Дезертирство'];
                                                    }),
                                                    backgroundColor: chartData.reasons.labels.map(r => chartData.causeColors[r]),
                                                    borderColor: '#17181b', borderWidth: 2
                                                }]
                                            }}
                                            options={{ cutout: '60%', plugins: { legend: { position: 'bottom', labels: { color: '#b8bec8' } } } }}
                                        />
                                    </div>

                                    {/* Інші графіки */}
                                    <div className="bg-[#17181b] border border-[#2e3138] rounded-sm p-4 lg:col-span-6 flex flex-col">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-1.5 bg-[#101113] border border-[#2e3138] rounded-sm"><Icon name="shield" className="w-4 h-4 text-[#4c8ed9]" /></div>
                                            <h3 className="font-bold text-[#e6edf3] text-sm">Втрати по підрозділах</h3>
                                        </div>
                                        <ChartComponent 
                                            title="Втрати_по_підрозділах" showLabels={showChartLabels} showPercentages={showChartPercentages}
                                            className="flex-1 min-h-[260px] w-full relative" type="bar"
                                            data={{
                                                labels: chartData.units.labels,
                                                datasets: [
                                                    { label: 'Бойові 200', data: chartData.units.labels.map(u => chartData.units.data[u]['200']), backgroundColor: '#71717a' },
                                                    { label: '200 (ПВР)', data: chartData.units.labels.map(u => chartData.units.data[u]['200 ПВР']), backgroundColor: '#4b5563' },
                                                    { label: 'Небойові 200', data: chartData.units.labels.map(u => chartData.units.data[u]['Неб. смерть']), backgroundColor: '#57534e' },
                                                    { label: 'Поранення', data: chartData.units.labels.map(u => chartData.units.data[u]['Поранення']), backgroundColor: '#ef4444' },
                                                    { label: 'Бойові', data: chartData.units.labels.map(u => chartData.units.data[u]['Бойове']), backgroundColor: '#f59e0b' },
                                                    { label: 'Небойові', data: chartData.units.labels.map(u => chartData.units.data[u]['Небойове']), backgroundColor: '#fde047' },
                                                    { label: 'ЗБВ', data: chartData.units.labels.map(u => chartData.units.data[u]['ЗБВ']), backgroundColor: '#3b82f6' },
                                                    { label: 'СЗЧ', data: chartData.units.labels.map(u => chartData.units.data[u]['СЗЧ']), backgroundColor: '#c026d3' },
                                                    { label: 'Дезертирство', data: chartData.units.labels.map(u => chartData.units.data[u]['Дезертирство']), backgroundColor: '#db2777' }
                                                ]
                                            }}
                                            options={{ plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: '#2e3138' }, ticks: { precision: 0 } } } }}
                                        />
                                    </div>

                                    <div className="bg-[#17181b] border border-[#2e3138] rounded-sm p-4 lg:col-span-6 flex flex-col">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-1.5 bg-[#101113] border border-[#2e3138] rounded-sm"><Icon name="activity" className="w-4 h-4 text-[#d9534f]" /></div>
                                            <h3 className="font-bold text-[#e6edf3] text-sm">Типи травм (по епізодах)</h3>
                                        </div>
                                        <ChartComponent 
                                            title="Типи_травм" showLabels={showChartLabels} showPercentages={showChartPercentages}
                                            className="flex-1 min-h-[260px] w-full relative" type="bar"
                                            data={{
                                                labels: Object.keys(chartData.injuryStats),
                                                datasets: [{ label: 'К-ть епізодів', data: Object.values(chartData.injuryStats), backgroundColor: '#d9534f', borderRadius: 2 }]
                                            }}
                                            options={{ plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 45 } }, y: { grid: { color: '#2e3138' }, ticks: { precision: 0 } } } }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ТАБ: ЛОГИ */}
                        {activeTab === "logs" && (
                            <div className="flex-1 flex flex-col md:flex-row gap-4 overflow-hidden">
                                <div className="w-full md:w-64 bg-[#17181b] border border-[#2e3138] p-3 rounded-sm shrink-0 flex flex-col gap-3">
                                    <div className="text-[10px] text-[#b8bec8] uppercase font-bold">Фільтр логів за часом</div>
                                    <div className="space-y-2">
                                        <input type="datetime-local" value={logTimeFrom} onChange={(e) => setLogTimeFrom(e.target.value)} className="w-full bg-[#101113] border border-[#2e3138] rounded-sm px-2 py-1 text-[10px] text-[#e6edf3] font-mono focus:outline-none focus:border-[#4c8ed9]" />
                                        <input type="datetime-local" value={logTimeTo} onChange={(e) => setLogTimeTo(e.target.value)} className="w-full bg-[#101113] border border-[#2e3138] rounded-sm px-2 py-1 text-[10px] text-[#e6edf3] font-mono focus:outline-none focus:border-[#4c8ed9]" />
                                    </div>
                                    {(logTimeFrom || logTimeTo) && (
                                        <button onClick={() => { setLogTimeFrom(""); setLogTimeTo(""); }} className="w-full py-1 bg-[#222429] hover:bg-[#2e3138] border border-[#2e3138] text-[10px] text-[#e6edf3] rounded-sm transition-colors cursor-pointer">Очистити часовий фільтр</button>
                                    )}
                                </div>
                                <div className="flex-1 bg-[#101113] border border-[#2e3138] rounded-sm p-3 overflow-y-auto space-y-2 relative">
                                    {filteredLogs.length === 0 ? (
                                        <div className="m-auto text-center text-[#989fa9] text-xs py-10">Немає записів за цей період</div>
                                    ) : (
                                        filteredLogs.map(log => (
                                            <div key={log.id} className={`border p-3 rounded-sm flex flex-col gap-1 transition-colors relative ${log.undone ? 'opacity-45 bg-[#17181b] border-[#2e3138]' : getLogRowStyle(log.action, log.details)}`}>
                                                {log.undone && (
                                                    <div className="absolute top-1.5 left-2 flex items-center gap-1.5">
                                                        <span className="text-[9px] font-bold text-[#b8bec8] bg-[#101113] border border-[#2e3138] px-1.5 py-0.5 rounded-sm uppercase tracking-wider flex items-center gap-1">
                                                            <Icon name="undo-2" className="w-2.5 h-2.5" /> скасовано
                                                        </span>
                                                    </div>
                                                )}
                                                <div className={`flex justify-between items-center text-[10px] opacity-85 border-b border-[#2e3138]/80 pb-1 tabular-nums ${log.undone ? 'mt-4' : ''}`}>
                                                    <span className={`font-mono ${log.undone ? 'line-through text-[#989fa9]' : ''}`}>{formatLogTime(log.timestamp)}</span>
                                                    <span className={`font-bold uppercase tracking-wider ${log.undone ? 'line-through text-[#989fa9]' : ''}`}>{log.action}</span>
                                                </div>
                                                <p className={`text-xs pt-1 leading-relaxed ${log.undone ? 'line-through text-[#989fa9]' : ''}`}>{log.details}</p>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </main>

                    {/* МОДАЛЬНІ ВІКНА */}
                    {(isAddWoundedOpen || isEditOpen) && (
                        <div onClick={(e) => { if (e.target === e.currentTarget) { setIsAddWoundedOpen(false); setIsEditOpen(false); } }} className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-2 sm:p-4 overflow-hidden overscroll-contain">
                            <form onSubmit={isEditOpen ? handleUpdateWounded : handleSaveWounded} className="bg-[#17181b] border border-[#2e3138] w-full max-w-7xl max-h-[94vh] rounded-sm flex flex-col overflow-hidden">
                                {/* Header */}
                                <div className="px-5 py-3.5 bg-[#101113] border-b border-[#2e3138] flex justify-between items-center shrink-0">
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-sm bg-[#222429] border border-[#2e3138] flex items-center justify-center text-[#4c8ed9] shrink-0">
                                            <Icon name={isEditOpen ? "file-pen-line" : "file-plus-2"} className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-[#e6edf3] text-base tracking-tight">
                                                {isEditOpen
                                                    ? (isAwol(lossType) ? 'Редагування запису СЗЧ / Повернення' : 'Редагування та статус запису')
                                                    : (isAwol(lossType) ? 'Новий запис СЗЧ / Повернення' : 'Створення нового запису')}
                                            </h3>
                                            <p className="text-[11px] text-[#b8bec8] font-mono tabular-nums">
                                                {isEditOpen
                                                    ? `ID епізоду: ${currentEpisode?.id || '—'}`
                                                    : (isAwol(lossType) ? 'Облік СЗЧ, дезертирства та повернення військовослужбовців' : 'Внесення події/поранення військовослужбовця')}
                                            </p>
                                        </div>
                                    </div>
                                    <button 
                                        type="button" 
                                        onClick={() => { setIsAddWoundedOpen(false); setIsEditOpen(false); }} 
                                        className="w-8 h-8 rounded-sm bg-[#17181b] hover:bg-[#222429] border border-[#2e3138] text-[#b8bec8] hover:text-[#e6edf3] flex items-center justify-center transition-colors cursor-pointer"
                                    >
                                        <Icon name="x" className="w-4 h-4" />
                                    </button>
                                </div>

                                <div className="p-5 overflow-y-auto overscroll-contain flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4">
                                    {/* 1. Ліва колонка */}
                                    <div className={`${isAny300(lossType) ? 'lg:col-span-3' : 'lg:col-span-6'} space-y-4 flex flex-col`}>
                                        <div className="bg-[#101113] border border-[#2e3138] rounded-sm p-4 space-y-3 relative">
                                            <div className="flex justify-between items-center gap-2 mb-1">
                                                <label className="text-[10px] text-[#b8bec8] font-bold uppercase font-mono tracking-wider flex items-center gap-1.5 whitespace-nowrap shrink-0">
                                                    <Icon name="user-check" className="w-3.5 h-3.5 text-[#4c8ed9]" />
                                                    <span>Анкетні дані</span>
                                                </label>
                                                {(selectedSoldierId || rosterSelection) && !isEditOpen && (
                                                    <button 
                                                        type="button" 
                                                        onClick={clearSelectedSoldier} 
                                                        className="text-[9px] text-[#8ad8ae] hover:text-[#f3a3a0] flex items-center gap-1 bg-[#3da372]/15 hover:bg-[#d9534f]/15 px-1.5 py-0.5 rounded-sm border border-[#3da372]/40 hover:border-[#d9534f]/40 font-mono font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                                                        title="Клікніть, щоб відв&apos;язати бійця"
                                                    >
                                                        <Icon name="check-circle" className="w-2.5 h-2.5" />
                                                        <span>Прив&apos;язано ✕</span>
                                                    </button>
                                                )}
                                            </div>
                                            <div className="space-y-2.5">
                                                {!isEditOpen && <p className="text-[10px] text-[#b8bec8] tabular-nums">Пошук за ПІБ або позивним у медичній базі та журналі О/С. Довідник О/С: {personnelDirectory.entries.length} записів. Вибір не змінює старі картки.</p>}
                                                {!isEditOpen && personnelDirectory.warning && <p role="alert" className="text-[10px] text-[#e7c574]">{personnelDirectory.warning}</p>}
                                                <input 
                                                    type="text" 
                                                    placeholder="ПІБ повністю..." 
                                                    value={newSoldierName} 
                                                    onChange={(e) => handleSmartInput('name', e.target.value)} 
                                                    className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm px-3 py-2 text-xs text-[#e6edf3] placeholder-[#989fa9] outline-none transition-colors font-sans" 
                                                />
                                                <input 
                                                    type="text" 
                                                    placeholder="Позивний (за наявності)..." 
                                                    value={newSoldierCallsign} 
                                                    onChange={(e) => handleSmartInput('callsign', e.target.value)} 
                                                    className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm px-3 py-2 text-xs text-[#e6edf3] placeholder-[#989fa9] outline-none transition-colors font-sans" 
                                                />
                                                
                                                {searchMatches.length > 0 && !selectedSoldierId && !isEditOpen && (
                                                    <div className="bg-[#17181b] border border-[#3c404a] rounded-sm overflow-hidden flex flex-col">
                                                        <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#2e3138] bg-[#101113] shrink-0">
                                                            <span className="text-[9px] text-[#b8bec8] uppercase font-bold font-mono">Знайдені збіги в базі:</span>
                                                            <button 
                                                                type="button" 
                                                                onClick={() => setSearchMatches([])} 
                                                                className="text-[10px] text-[#4c8ed9] hover:text-[#e6edf3] font-semibold flex items-center gap-1 px-2 py-0.5 rounded-sm bg-[#222429] hover:bg-[#2e3138] cursor-pointer transition-colors"
                                                            >
                                                                <span>Створити як нового</span>
                                                                <Icon name="x" className="w-2.5 h-2.5" />
                                                            </button>
                                                        </div>
                                                        <div className="max-h-48 overflow-y-auto p-1.5 space-y-1">
                                                            {searchMatches.map(s => {
                                                                const hasMedLink = s.source === 'roster' && Boolean(MedicalPersonnelDirectory.resolve(s, soldiers).match);
                                                                return (
                                                                    <button type="button" key={`${s.source}:${s.id}`} onClick={() => selectExistingSoldier(s)} data-testid="personnel-match" data-source={s.source} className="block w-full text-left p-2.5 rounded-sm border border-transparent hover:border-[#4c8ed9]/50 bg-[#101113] hover:bg-[#222429] cursor-pointer text-xs transition-colors">
                                                                        <div className="font-bold text-[#e6edf3] flex items-center justify-between gap-2">
                                                                            <span className="truncate">{s.name}</span>
                                                                            {s.callsign && <span className="text-[#4c8ed9] font-mono shrink-0">«{formatCallsignUI(s.callsign)}»</span>}
                                                                        </div>
                                                                        <div className="text-[10px] text-[#b8bec8] font-mono mt-0.5">{s.rank || '—'} | {s.unit || '—'}</div>
                                                                        <div className="text-[10px] text-[#8ad8ae] mt-1">
                                                                            {s.source === 'roster' ? (hasMedLink ? 'Журнал О/С · Медична база' : 'Журнал О/С') : 'Медична база'}
                                                                        </div>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            {rosterSelection && <p data-testid="roster-selection" className="text-[10px] text-[#8ad8ae]">Обрано з О/С: {rosterSelection.name || rosterSelection.callsign}. {selectedSoldierId ? 'Буде використана існуюча медична картка; її анкетні дані не перезаписуються.' : 'Медична картка створиться лише після збереження події.'}</p>}
                                            {!!rosterCandidates.length && <div role="alert" className="border border-[#d99b26]/60 bg-[#d99b26]/10 rounded-sm p-2 space-y-2 text-xs">
                                                <p className="text-[#f3d88e]">Є неоднозначний збіг зі старою базою. Оберіть, чи це та сама людина. Автоматичного об’єднання не буде.</p>
                                                {rosterCandidates.map(person => <button key={person.id} type="button" onClick={() => chooseRosterPerson(rosterSelection, person)} className="block w-full text-left bg-[#17181b] hover:bg-[#222429] border border-[#2e3138] p-2 rounded-sm">Це та сама людина: {person.name} · {person.callsign || 'без позивного'} · {person.rank || '—'} · {person.unit || '—'} · ID {person.id}</button>)}
                                                <button type="button" onClick={() => chooseRosterPerson(rosterSelection)} className="text-[#f3d88e] underline cursor-pointer">Це інша особа — створити окрему картку</button>
                                            </div>}
                                            <div className="grid grid-cols-2 gap-2 pt-1">
                                                <select aria-label="Звання військовослужбовця" value={newSoldierRank} onChange={(e) => setNewSoldierRank(e.target.value)} className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm px-2.5 py-2 text-xs text-[#e6edf3] outline-none cursor-pointer">
                                                    <option value="">-- Звання --</option>
                                                    {dictionaryOptions('ranks', settings.ranks || [], newSoldierRank).map(r => <option key={r} value={r}>{r}</option>)}
                                                </select>
                                                <select aria-label="Підрозділ військовослужбовця" value={newSoldierUnit} onChange={(e) => setNewSoldierUnit(e.target.value)} className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm px-2.5 py-2 text-xs text-[#e6edf3] outline-none cursor-pointer">
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
                                                <div className="bg-[#d99b26]/10 border border-[#d99b26]/50 rounded-sm p-3.5 space-y-2 text-xs">
                                                    <div className="flex items-center gap-2 text-[#f3d88e] font-bold">
                                                        <Icon name="alert-triangle" className="w-4 h-4 text-[#d99b26] shrink-0" />
                                                        <span>У бійця вже є відкритий запис у черзі!</span>
                                                    </div>
                                                    <p className="text-[11px] text-[#e6edf3] leading-relaxed tabular-nums">
                                                        Попередній статус: <strong className="text-[#f3d88e] font-mono">{activeUnevac.lossType}</strong> від <span className="font-mono text-[#e6edf3]">{formatEpisodeDateUI(activeUnevac.date)}</span> (<span className="text-[#f3a3a0] font-bold">{activeUnevac.evacStatus}</span>).
                                                    </p>
                                                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#d99b26]/25 flex-wrap">
                                                        <span className="text-[10px] text-[#b8bec8] italic">
                                                            Створення нового запису оновить актуальний статус бійця в черзі, зберігши історію.
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleStartEdit(activeUnevac)}
                                                            className="text-[10px] text-[#f3d88e] hover:text-[#e6edf3] bg-[#d99b26]/15 hover:bg-[#d99b26]/25 border border-[#d99b26]/50 px-2.5 py-1 rounded-sm font-bold transition-colors shrink-0 cursor-pointer flex items-center gap-1"
                                                        >
                                                            <span>Редагувати старий запис</span>
                                                            <Icon name="arrow-right" className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {soldierHistory.length > 0 && (
                                            <div className="bg-[#101113] border border-[#2e3138] rounded-sm p-4 space-y-2.5">
                                                <label className="text-[10px] text-[#b8bec8] font-bold uppercase font-mono tracking-wider flex items-center justify-between gap-1.5 tabular-nums">
                                                    <span className="flex items-center gap-1.5">
                                                        <Icon name="history" className="w-3.5 h-3.5 text-[#4c8ed9]" />
                                                        <span>Історія епізодів бійця ({soldierHistory.length})</span>
                                                    </span>
                                                    <span className="text-[9px] text-[#989fa9] font-normal">Клікніть для редагування</span>
                                                </label>
                                                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                                                    {soldierHistory.map(h => (
                                                        <div key={h.id} className="bg-[#17181b] hover:bg-[#222429] border border-[#2e3138] hover:border-[#4c8ed9] p-2.5 rounded-sm text-xs flex justify-between items-start gap-2 transition-colors cursor-pointer group tabular-nums" title="Натисніть для переходу до запису" onClick={() => handleStartEdit(h)}>
                                                            <div>
                                                                <div className="text-[#e6edf3] font-bold group-hover:text-[#4c8ed9] transition-colors">{h.lossType}</div>
                                                                <div className="text-[10px] text-[#b8bec8] font-mono mt-0.5">{localMedicalInput(h.date).replace('T', ' ') || 'Некоректна дата'}</div>
                                                            </div>
                                                            <div className="text-right font-mono">
                                                                {isAny300(h.lossType) && <div className="text-[10px] text-[#e7c574] font-bold">{h.severity || 'Невідомо'}</div>}
                                                                {isAwol(h.lossType) ? (
                                                                    <div className={`text-[10px] font-semibold mt-0.5 ${isAwolReturnEp(h) ? 'text-[#8ad8ae]' : 'text-[#c084fc]'}`}>
                                                                        {isAwolReturnEp(h) ? 'Повернувся' : (h.awolStatus || 'В розшуку')}
                                                                    </div>
                                                                ) : h.lossType !== 'Зниклий безвісти (ЗБВ)' && (
                                                                    <div className={`text-[10px] font-semibold mt-0.5 ${h.evacStatus === 'Евакуйований' ? 'text-[#8ad8ae]' : 'text-[#f3a3a0]'}`}>{h.evacStatus}</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <div className="bg-[#101113] border border-[#2e3138] rounded-sm p-4 space-y-3">
                                            <div>
                                                <label className="text-[10px] text-[#b8bec8] font-bold uppercase font-mono tracking-wider block mb-1.5">Тип події</label>
                                                <select aria-label="Тип медичного запису" value={lossType} onChange={(e) => {
                                                    const newType = e.target.value;
                                                    if (isEditOpen && currentEpisode) {
                                                        const oldType = currentEpisode.lossType;
                                                        if (isAny300(oldType) && (isAny200(newType) || newType === 'Зниклий безвісти (ЗБВ)')) {
                                                            setHasReport(false);
                                                            setWeaponStatus("");
                                                        }
                                                    }
                                                    if (isAwol(newType) && !isAwol(lossType) && DEFAULT_CAUSES.includes(cause)) {
                                                        setCause("");
                                                    } else if (!isAwol(newType) && isAwol(lossType) && DEFAULT_AWOL_CAUSES.includes(cause)) {
                                                        setCause("");
                                                    }
                                                    if (newType === "Повернення з СЗЧ") {
                                                        setAwolStatus("Повернувся");
                                                    } else if (newType === "СЗЧ" || (newType === "Дезертирство" && lossType === "Повернення з СЗЧ")) {
                                                        setAwolStatus("В розшуку");
                                                    }
                                                    setLossType(newType);
                                                }} className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm px-3 py-2 text-xs font-bold text-[#e6edf3] outline-none cursor-pointer">
                                                    <option value="">-- Оберіть тип події --</option>
                                                    {LOSS_TYPES.filter(type => {
                                                        if (type === "200 (від ран)") {
                                                            const activeUnevac = soldierHistory.find(e => e.evacStatus === 'Не евакуйований' && isAny300(e.lossType));
                                                            return !!activeUnevac;
                                                        }
                                                        return true;
                                                    }).map(type => <option key={type} value={type}>{type}</option>)}
                                                </select>
                                            </div>
                                            
                                            {isAny300(lossType) && (
                                                <div>
                                                    <label className="text-[10px] text-[#b8bec8] font-bold uppercase font-mono tracking-wider block mb-1.5">Важкість ураження</label>
                                                    <select aria-label="Важкість у медичному записі" value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm px-3 py-2 text-xs text-[#e6edf3] outline-none cursor-pointer">
                                                        <option value="">-- Оберіть важкість --</option>
                                                        <option value="Легкий">Легкий</option>
                                                        <option value="Середній">Середній</option>
                                                        <option value="Важкий">Важкий</option>
                                                        <option value="Критичний">Критичний</option>
                                                    </select>
                                                </div>
                                            )}

                                            {!isAwol(lossType) && (
                                                <div>
                                                    <label className="text-[10px] text-[#b8bec8] font-bold uppercase font-mono tracking-wider block mb-1.5">Причина події</label>
                                                    <select aria-label="Причина медичного запису" value={cause} onChange={(e) => setCause(e.target.value)} className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm px-3 py-2 text-xs text-[#e6edf3] outline-none cursor-pointer">
                                                        <option value="">-- Оберіть причину --</option>
                                                        {dictionaryOptions('causes', settings.causes, cause).map(c => <option key={c} value={c}>{c}</option>)}
                                                    </select>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* 2. Середня колонка */}
                                    <div className={`${isAny300(lossType) ? 'lg:col-span-4' : 'lg:col-span-6'} space-y-4`}>
                                        {!isAwol(lossType) && (
                                            <div className="bg-[#101113] border border-[#2e3138] rounded-sm p-4 space-y-3">
                                                <div>
                                                    <div className="flex justify-between items-center mb-1.5">
                                                        <label className="text-[10px] text-[#b8bec8] font-bold uppercase font-mono tracking-wider">Час події</label>
                                                        <button
                                                            type="button"
                                                            onClick={() => setEpisodeDate(localMedicalInput(new Date()))}
                                                            className="text-[10px] font-mono font-bold text-[#4c8ed9] hover:text-[#e6edf3] bg-[#4c8ed9]/10 hover:bg-[#4c8ed9]/20 border border-[#4c8ed9]/40 rounded-sm px-1.5 py-0.5 transition-colors cursor-pointer flex items-center gap-1"
                                                            title="Підставити поточну дату та час"
                                                        >
                                                            <Icon name="clock" className="w-2.5 h-2.5" />
                                                            <span>Зараз</span>
                                                        </button>
                                                    </div>
                                                    <input aria-label="Дата й час медичного запису" type="datetime-local" value={episodeDate} onChange={(e) => setEpisodeDate(e.target.value)} className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm px-3 py-2 text-xs font-mono text-[#e6edf3] outline-none transition-colors" />
                                                </div>
                                                
                                                <label className={`flex items-center gap-2.5 text-xs font-bold p-3 rounded-sm border cursor-pointer select-none transition-colors ${inUdp ? 'bg-[#d9534f]/15 border-[#d9534f]/50 text-[#f3a3a0]' : 'bg-[#17181b] border-[#2e3138] text-[#b8bec8] hover:text-[#e6edf3]'}`}>
                                                    <input type="checkbox" checked={inUdp} onChange={(e) => setInUdp(e.target.checked)} className="rounded-sm bg-[#101113] border-[#3c404a] text-[#d9534f] focus:ring-0 w-4 h-4 cursor-pointer" />
                                                    <span className="flex items-center gap-1.5">
                                                        <Icon name="zap" className="w-4 h-4 text-[#d9534f]" />
                                                        <span>Отримано під час УПД</span>
                                                    </span>
                                                </label>

                                                <div>
                                                    <label className="text-[10px] text-[#b8bec8] font-bold uppercase font-mono tracking-wider block mb-1.5">Фактичне місце отримання</label>
                                                    <input aria-label="Фактичне місце отримання" list="med-actual-locs" placeholder="Оберіть або введіть своє..." value={actualLoc} onChange={(e) => setActualLoc(e.target.value)} className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm px-3 py-2 text-xs text-[#e6edf3] placeholder-[#989fa9] outline-none transition-colors font-sans" />
                                                    <datalist id="med-actual-locs">{dictionaryOptions('actualPlaces', episodes.map(episode => episode.actualLoc), actualLoc).map(name => <option key={name} value={name} />)}</datalist>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-[#b8bec8] font-bold uppercase font-mono tracking-wider block mb-1.5">Документальне місце</label>
                                                    <input aria-label="Документальне місце" list="med-document-locs" placeholder="Оберіть або введіть своє..." value={docLoc} onChange={(e) => setDocLoc(e.target.value)} className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm px-3 py-2 text-xs text-[#e6edf3] placeholder-[#989fa9] outline-none transition-colors font-sans" />
                                                    <datalist id="med-document-locs">
                                                        {dictionaryOptions('docPlaces', episodes.map(episode => episode.docLoc), docLoc).map(name => <option key={name} value={name} />)}
                                                    </datalist>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-[#b8bec8] font-bold uppercase font-mono tracking-wider block mb-1.5">Опис / Нотатки</label>
                                                    <textarea rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Короткий опис обставин..." className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm px-3 py-2 text-xs text-[#e6edf3] placeholder-[#989fa9] outline-none transition-colors font-sans resize-none"></textarea>
                                                </div>
                                            </div>
                                        )}

                                        {!isAwol(lossType) && lossType !== "Зниклий безвісти (ЗБВ)" && (
                                            <div className="bg-[#101113] border border-[#2e3138] rounded-sm p-4 space-y-3">
                                                <div>
                                                    <label className="text-[10px] text-[#b8bec8] font-bold uppercase font-mono tracking-wider block mb-1.5">Статус евакуації</label>
                                                    <select value={evacStatus} onChange={(e) => setEvacStatus(e.target.value)} className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm px-3 py-2 text-xs text-[#e6edf3] outline-none cursor-pointer">
                                                        <option value="Не евакуйований">Не евакуйований</option>
                                                        <option value="Евакуйований">Евакуйований</option>
                                                        <option value="Не потребує евакуації">Не потребує евакуації</option>
                                                    </select>
                                                </div>
                                                {evacStatus === "Евакуйований" && (
                                                    <div>
                                                        <div className="flex justify-between items-center mb-1.5">
                                                            <label className="text-[10px] text-[#b8bec8] font-bold uppercase font-mono tracking-wider">Дата евакуації</label>
                                                            <span className="text-[9px] text-[#989fa9] font-mono">за замовч. сьогодні</span>
                                                        </div>
                                                        <input type="date" value={evacDate} onChange={(e) => setEvacDate(e.target.value)} className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm px-3 py-2 text-xs font-mono text-[#e6edf3] outline-none transition-colors" />
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {isAwol(lossType) && (() => {
                                            const isReturnedForm = lossType === "Повернення з СЗЧ" || awolStatus === "Повернувся";
                                            const setAwolMode = (nextStatus) => {
                                                setAwolStatus(nextStatus);
                                                if (nextStatus === "Повернувся") {
                                                    if (lossType === "СЗЧ") setLossType("Повернення з СЗЧ");
                                                    if (!evacDate) setEvacDate(new Date().toLocaleDateString('en-CA'));
                                                } else if (nextStatus === "В розшуку" && lossType === "Повернення з СЗЧ") {
                                                    setLossType("СЗЧ");
                                                }
                                            };
                                            return (
                                                <div className={`${isReturnedForm ? 'bg-[#3da372]/10 border-[#3da372]/40' : 'bg-[#8f5fb8]/10 border-[#8f5fb8]/40'} border rounded-sm p-4 space-y-3.5 transition-colors`}>
                                                    {/* 1. Наочний перемикач статусу: В розшуку vs Повернувся */}
                                                    <div>
                                                        <label className={`text-[10px] ${isReturnedForm ? 'text-[#8ad8ae]' : 'text-[#d8b4fe]'} font-bold uppercase font-mono tracking-wider block mb-1.5`}>
                                                            Статус обліку {lossType === "Дезертирство" ? "дезертирства" : "СЗЧ"}
                                                        </label>
                                                        <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#101113] border border-[#2e3138] rounded-sm">
                                                            <button
                                                                type="button"
                                                                onClick={() => setAwolMode("В розшуку")}
                                                                className={`py-2 px-3 rounded-sm text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                                                                    !isReturnedForm
                                                                        ? 'bg-[#8f5fb8]/20 border border-[#8f5fb8]/60 text-[#e9d5ff]'
                                                                        : 'border border-transparent text-[#b8bec8] hover:text-[#e6edf3] hover:bg-[#222429]'
                                                                }`}
                                                            >
                                                                <Icon name="user-x" className="w-3.5 h-3.5 text-[#c084fc]" />
                                                                <span>В розшуку (СЗЧ)</span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => setAwolMode("Повернувся")}
                                                                className={`py-2 px-3 rounded-sm text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                                                                    isReturnedForm
                                                                        ? 'bg-[#3da372]/20 border border-[#3da372]/60 text-[#8ad8ae]'
                                                                        : 'border border-transparent text-[#b8bec8] hover:text-[#e6edf3] hover:bg-[#222429]'
                                                                }`}
                                                            >
                                                                <Icon name="check-circle" className="w-3.5 h-3.5 text-[#3da372]" />
                                                                <span>Повернувся в стрій</span>
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* 2. Дати в одному блоці пліч-о-пліч: Дата та час СЗЧ (вибуття) + Дата повернення */}
                                                    <div className={`grid grid-cols-1 ${isReturnedForm ? 'sm:grid-cols-2' : ''} gap-3 bg-[#101113] border border-[#2e3138] rounded-sm p-3`}>
                                                        <div>
                                                            <div className="flex justify-between items-center mb-1.5">
                                                                <label className="text-[10px] text-[#d8b4fe] font-bold uppercase font-mono tracking-wider flex items-center gap-1">
                                                                    <Icon name="calendar" className="w-3 h-3 text-[#c084fc]" />
                                                                    <span>Дата та час СЗЧ (вибуття)</span>
                                                                </label>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setEpisodeDate(localMedicalInput(new Date()))}
                                                                    className="text-[10px] font-mono font-bold text-[#d8b4fe] hover:text-[#e6edf3] bg-[#8f5fb8]/15 hover:bg-[#8f5fb8]/25 border border-[#8f5fb8]/40 rounded-sm px-1.5 py-0.5 transition-colors cursor-pointer flex items-center gap-1"
                                                                    title="Підставити поточну дату та час"
                                                                >
                                                                    <Icon name="clock" className="w-2.5 h-2.5" />
                                                                    <span>Зараз</span>
                                                                </button>
                                                            </div>
                                                            <input
                                                                aria-label="Дата й час медичного запису"
                                                                type="datetime-local"
                                                                value={episodeDate}
                                                                onChange={(e) => setEpisodeDate(e.target.value)}
                                                                className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#c084fc] rounded-sm px-3 py-2 text-xs font-mono text-[#e6edf3] outline-none transition-colors"
                                                            />
                                                        </div>

                                                        {isReturnedForm && (
                                                            <div>
                                                                <div className="flex justify-between items-center mb-1.5">
                                                                    <label className="text-[10px] text-[#8ad8ae] font-bold uppercase font-mono tracking-wider flex items-center gap-1">
                                                                        <Icon name="check-circle" className="w-3 h-3 text-[#3da372]" />
                                                                        <span>Дата повернення</span>
                                                                    </label>
                                                                    <span className="text-[9px] text-[#989fa9] font-mono">за замовч. сьогодні</span>
                                                                </div>
                                                                <input
                                                                    type="date"
                                                                    value={evacDate}
                                                                    onChange={(e) => setEvacDate(e.target.value)}
                                                                    className="w-full bg-[#17181b] border border-[#3da372]/50 focus:border-[#3da372] rounded-sm px-3 py-2 text-xs font-mono text-[#8ad8ae] outline-none transition-colors"
                                                                />
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* 3. Звідки вибув / Обставини СЗЧ */}
                                                    <div>
                                                        <label className={`text-[10px] ${isReturnedForm ? 'text-[#8ad8ae]' : 'text-[#d8b4fe]'} font-bold uppercase font-mono tracking-wider block mb-1.5`}>
                                                            Звідки вибув / Обставини {lossType === "Повернення з СЗЧ" ? "СЗЧ" : lossType}
                                                        </label>
                                                        <select
                                                            aria-label="Звідки вибув / Обставини СЗЧ"
                                                            value={cause}
                                                            onChange={(e) => setCause(e.target.value)}
                                                            className={`w-full bg-[#17181b] border border-[#2e3138] ${isReturnedForm ? 'focus:border-[#3da372]' : 'focus:border-[#c084fc]'} rounded-sm px-3 py-2 text-xs text-[#e6edf3] outline-none cursor-pointer`}
                                                        >
                                                            <option value="">-- Оберіть звідки вибув --</option>
                                                            {DEFAULT_AWOL_CAUSES.map(c => <option key={c} value={c}>{c}</option>)}
                                                            {cause && !DEFAULT_AWOL_CAUSES.includes(cause) && <option value={cause}>{cause}</option>}
                                                        </select>
                                                    </div>

                                                    {/* 4. Місце / локація вибуття (необов’язково) */}
                                                    <div>
                                                        <div className="flex justify-between items-center mb-1.5">
                                                            <label className="text-[10px] text-[#b8bec8] font-bold uppercase font-mono tracking-wider">Місце / локація вибуття</label>
                                                            <span className="text-[9px] text-[#989fa9] font-mono">необов&apos;язково</span>
                                                        </div>
                                                        <input
                                                            aria-label="Фактичне місце отримання"
                                                            list="med-actual-locs"
                                                            placeholder="Напр.: н.п. Лиман, НЦ, маршрут переміщення..."
                                                            value={actualLoc}
                                                            onChange={(e) => setActualLoc(e.target.value)}
                                                            className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#c084fc] rounded-sm px-3 py-2 text-xs text-[#e6edf3] placeholder-[#989fa9] outline-none transition-colors font-sans"
                                                        />
                                                        <datalist id="med-actual-locs">{dictionaryOptions('actualPlaces', episodes.map(episode => episode.actualLoc), actualLoc).map(name => <option key={name} value={name} />)}</datalist>
                                                    </div>

                                                    {/* 5. Опис / Нотатки */}
                                                    <div>
                                                        <label className="text-[10px] text-[#b8bec8] font-bold uppercase font-mono tracking-wider block mb-1.5">Опис / Нотатки</label>
                                                        <textarea
                                                            rows="2"
                                                            value={notes}
                                                            onChange={(e) => setNotes(e.target.value)}
                                                            placeholder="Додаткові деталі вибуття або обставини повернення..."
                                                            className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#c084fc] rounded-sm px-3 py-2 text-xs text-[#e6edf3] placeholder-[#989fa9] outline-none transition-colors font-sans resize-none"
                                                        ></textarea>
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        <div className="bg-[#101113] border border-[#2e3138] rounded-sm p-4 space-y-3">
                                            <label className="flex items-center gap-2.5 text-xs font-semibold text-[#e6edf3] cursor-pointer select-none">
                                                <input type="checkbox" checked={hasReport} onChange={(e) => {
                                                    setHasReport(e.target.checked);
                                                    if(!e.target.checked) setWeaponStatus("");
                                                }} className="rounded-sm bg-[#17181b] border-[#3c404a] text-[#4c8ed9] focus:ring-0 w-4 h-4 cursor-pointer"/> 
                                                <span>Складено рапорт</span>
                                            </label>
                                            {hasReport && (
                                                <div className="space-y-3 pl-4 border-l-2 border-[#2e3138] mt-2">
                                                    <div>
                                                        <div className="flex justify-between items-center mb-1.5">
                                                            <label className="text-[10px] text-[#b8bec8] font-bold uppercase font-mono tracking-wider">Дата рапорту</label>
                                                            <span className="text-[9px] text-[#989fa9] font-mono">за замовч. сьогодні</span>
                                                        </div>
                                                        <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm px-3 py-2 text-xs font-mono text-[#e6edf3] outline-none transition-colors" />
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] text-[#b8bec8] font-bold uppercase font-mono tracking-wider mb-1.5 flex items-center gap-1.5">
                                                            <Icon name="crosshair" className="w-3.5 h-3.5 text-[#4c8ed9]" />
                                                            <span>Статус зброї</span>
                                                        </label>
                                                        <select value={weaponStatus} onChange={(e) => setWeaponStatus(e.target.value)} className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm px-3 py-2 text-xs text-[#e6edf3] outline-none cursor-pointer">
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

                                    {/* 3. Права колонка: Інтерактивна карта тіла */}
                                    {isAny300(lossType) ? (
                                        <div className="lg:col-span-5 bg-[#101113] border border-[#2e3138] rounded-sm p-4 flex flex-col space-y-3 relative overflow-visible">
                                            
                                            {/* Заголовок анатомічного блоку */}
                                            <div className="w-full flex items-center justify-between border-b border-[#2e3138] pb-2">
                                                <div className="flex items-center gap-2 text-xs font-bold uppercase text-[#e6edf3] font-mono tracking-wider">
                                                    <Icon name="activity" className="w-4 h-4 text-[#4c8ed9]" />
                                                    <span>Карта уражень</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-[#989fa9] font-mono">Вигляд спереду</span>
                                                    {Object.keys(injuries).some(k => Object.values(injuries[k] || {}).some(Boolean)) && (
                                                        <button 
                                                            type="button" 
                                                            onClick={() => setInjuries({})} 
                                                            className="text-[10px] text-[#f3a3a0] hover:text-[#e6edf3] font-semibold cursor-pointer flex items-center gap-1 bg-[#d9534f]/10 hover:bg-[#d9534f]/20 px-1.5 py-0.5 rounded-sm border border-[#d9534f]/40 transition-colors"
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
                                                {/* Силует */}
                                                <div className="relative w-full sm:w-[140px] shrink-0 border border-[#2e3138] rounded-sm bg-[#17181b] p-2 flex items-center justify-center group">
                                                    <span className="absolute top-2.5 left-2.5 text-[9px] font-mono font-bold text-[#b8bec8] bg-[#101113] px-1.5 py-0.5 rounded-sm border border-[#2e3138]" title="Права сторона бійця">П</span>
                                                    <span className="absolute top-2.5 right-2.5 text-[9px] font-mono font-bold text-[#b8bec8] bg-[#101113] px-1.5 py-0.5 rounded-sm border border-[#2e3138]" title="Ліва сторона бійця">Л</span>

                                                    <svg viewBox="0 0 220 380" className="w-full h-auto max-h-[350px] select-none">
                                                        {/* Голова */}
                                                        <g onClick={() => setSelectedRegion('head')} className="cursor-pointer">
                                                            <path 
                                                                d="M110,18 C94,18 84,32 84,48 C84,65 96,78 110,82 C124,78 136,65 136,48 C136,32 126,18 110,18 Z" 
                                                                fill={hasAnyInjury('head') ? '#d9534f' : (selectedRegion === 'head' ? '#222429' : '#101113')} 
                                                                stroke={selectedRegion === 'head' ? '#4c8ed9' : (hasAnyInjury('head') ? '#f3a3a0' : '#3c404a')} 
                                                                strokeWidth={selectedRegion === 'head' ? '2.5' : '1.5'} 
                                                                className="transition-colors hover:stroke-[#4c8ed9]"
                                                            />
                                                            {hasAnyInjury('head') && (
                                                                <circle cx="110" cy="48" r="4.5" fill="#e6edf3" />
                                                            )}
                                                        </g>

                                                        {/* Шия */}
                                                        <g onClick={() => setSelectedRegion('neck')} className="cursor-pointer">
                                                            <path 
                                                                d="M102,82 L118,82 L122,96 L98,96 Z" 
                                                                fill={hasAnyInjury('neck') ? '#d9534f' : (selectedRegion === 'neck' ? '#222429' : '#101113')} 
                                                                stroke={selectedRegion === 'neck' ? '#4c8ed9' : (hasAnyInjury('neck') ? '#f3a3a0' : '#3c404a')} 
                                                                strokeWidth={selectedRegion === 'neck' ? '2.5' : '1.5'} 
                                                                className="transition-colors hover:stroke-[#4c8ed9]"
                                                            />
                                                        </g>

                                                        {/* Грудна клітка / Торс */}
                                                        <g onClick={() => setSelectedRegion('chest')} className="cursor-pointer">
                                                            <path 
                                                                d="M98,96 L122,96 L148,104 L142,165 L78,165 L72,104 Z" 
                                                                fill={hasAnyInjury('chest') ? '#d9534f' : (selectedRegion === 'chest' ? '#222429' : '#101113')} 
                                                                stroke={selectedRegion === 'chest' ? '#4c8ed9' : (hasAnyInjury('chest') ? '#f3a3a0' : '#3c404a')} 
                                                                strokeWidth={selectedRegion === 'chest' ? '2.5' : '1.5'} 
                                                                className="transition-colors hover:stroke-[#4c8ed9]"
                                                            />
                                                            {hasAnyInjury('chest') && (
                                                                <circle cx="110" cy="130" r="4.5" fill="#e6edf3" />
                                                            )}
                                                        </g>

                                                        {/* Живіт / Пах */}
                                                        <g onClick={() => setSelectedRegion('abdomen')} className="cursor-pointer">
                                                            <path 
                                                                d="M78,165 L142,165 L136,215 L84,215 Z" 
                                                                fill={hasAnyInjury('abdomen') ? '#d9534f' : (selectedRegion === 'abdomen' ? '#222429' : '#101113')} 
                                                                stroke={selectedRegion === 'abdomen' ? '#4c8ed9' : (hasAnyInjury('abdomen') ? '#f3a3a0' : '#3c404a')} 
                                                                strokeWidth={selectedRegion === 'abdomen' ? '2.5' : '1.5'} 
                                                                className="transition-colors hover:stroke-[#4c8ed9]"
                                                            />
                                                            {hasAnyInjury('abdomen') && (
                                                                <circle cx="110" cy="190" r="4.5" fill="#e6edf3" />
                                                            )}
                                                        </g>

                                                        {/* Права рука бійця (Viewer left) */}
                                                        <g onClick={() => setSelectedRegion('arm_r')} className="cursor-pointer">
                                                            <path 
                                                                d="M72,104 C60,110 46,135 40,165 C34,195 28,225 34,230 C40,235 48,225 54,195 C60,165 72,140 78,120 Z" 
                                                                fill={hasAnyInjury('arm_r') ? '#d9534f' : (selectedRegion === 'arm_r' ? '#222429' : '#101113')} 
                                                                stroke={selectedRegion === 'arm_r' ? '#4c8ed9' : (hasAnyInjury('arm_r') ? '#f3a3a0' : '#3c404a')} 
                                                                strokeWidth={selectedRegion === 'arm_r' ? '2.5' : '1.5'} 
                                                                className="transition-colors hover:stroke-[#4c8ed9]"
                                                            />
                                                            {hasAnyInjury('arm_r') && (
                                                                <circle cx="48" cy="165" r="4.5" fill="#e6edf3" />
                                                            )}
                                                        </g>

                                                        {/* Ліва рука бійця (Viewer right) */}
                                                        <g onClick={() => setSelectedRegion('arm_l')} className="cursor-pointer">
                                                            <path 
                                                                d="M148,104 C160,110 174,135 180,165 C186,195 192,225 186,230 C180,235 172,225 166,195 C160,165 148,140 142,120 Z" 
                                                                fill={hasAnyInjury('arm_l') ? '#d9534f' : (selectedRegion === 'arm_l' ? '#222429' : '#101113')} 
                                                                stroke={selectedRegion === 'arm_l' ? '#4c8ed9' : (hasAnyInjury('arm_l') ? '#f3a3a0' : '#3c404a')} 
                                                                strokeWidth={selectedRegion === 'arm_l' ? '2.5' : '1.5'} 
                                                                className="transition-colors hover:stroke-[#4c8ed9]"
                                                            />
                                                            {hasAnyInjury('arm_l') && (
                                                                <circle cx="172" cy="165" r="4.5" fill="#e6edf3" />
                                                            )}
                                                        </g>

                                                        {/* Права нога бійця (Viewer left) */}
                                                        <g onClick={() => setSelectedRegion('leg_r')} className="cursor-pointer">
                                                            <path 
                                                                d="M84,215 L106,215 L100,290 L98,365 L74,365 L72,290 Z" 
                                                                fill={hasAnyInjury('leg_r') ? '#d9534f' : (selectedRegion === 'leg_r' ? '#222429' : '#101113')} 
                                                                stroke={selectedRegion === 'leg_r' ? '#4c8ed9' : (hasAnyInjury('leg_r') ? '#f3a3a0' : '#3c404a')} 
                                                                strokeWidth={selectedRegion === 'leg_r' ? '2.5' : '1.5'} 
                                                                className="transition-colors hover:stroke-[#4c8ed9]"
                                                            />
                                                            {hasAnyInjury('leg_r') && (
                                                                <circle cx="86" cy="285" r="4.5" fill="#e6edf3" />
                                                            )}
                                                        </g>

                                                        {/* Ліва нога бійця (Viewer right) */}
                                                        <g onClick={() => setSelectedRegion('leg_l')} className="cursor-pointer">
                                                            <path 
                                                                d="M114,215 L136,215 L148,290 L146,365 L122,365 L120,290 Z" 
                                                                fill={hasAnyInjury('leg_l') ? '#d9534f' : (selectedRegion === 'leg_l' ? '#222429' : '#101113')} 
                                                                stroke={selectedRegion === 'leg_l' ? '#4c8ed9' : (hasAnyInjury('leg_l') ? '#f3a3a0' : '#3c404a')} 
                                                                strokeWidth={selectedRegion === 'leg_l' ? '2.5' : '1.5'} 
                                                                className="transition-colors hover:stroke-[#4c8ed9]"
                                                            />
                                                            {hasAnyInjury('leg_l') && (
                                                                <circle cx="134" cy="285" r="4.5" fill="#e6edf3" />
                                                            )}
                                                        </g>
                                                    </svg>
                                                </div>

                                                {/* Панель вибору травм для активної зони з повним текстом */}
                                                <div className="flex-1 bg-[#17181b] border border-[#2e3138] rounded-sm p-3 flex flex-col justify-start space-y-2.5 min-w-0">
                                                    <div className="text-xs font-bold text-[#e6edf3] uppercase font-mono border-b border-[#2e3138] pb-1.5 flex justify-between items-center shrink-0">
                                                        <span className="flex items-center gap-1.5 min-w-0">
                                                            <span className="w-2 h-2 rounded-full bg-[#4c8ed9] shrink-0"></span>
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
                                                                className="text-[10px] text-[#4c8ed9] hover:text-[#e6edf3] font-semibold cursor-pointer hover:underline shrink-0 ml-1"
                                                            >
                                                                Очистити
                                                            </button>
                                                        )}
                                                    </div>

                                                    {(() => {
                                                        let injuryOptions = [
                                                            { key: 'shrapnel', icon: 'crosshair', label: 'Уламкове', desc: 'Ураження уламками снарядів, мін, гранат, ВОГ або FPV-дронів' },
                                                            { key: 'bullet', icon: 'target', label: 'Кульове', desc: 'Вогнепальне поранення кулями стрілецької зброї' },
                                                            { key: 'fracture', icon: 'activity', label: 'Перелом', desc: 'Закритий або відкритий перелом кісток внаслідок удару, вибуху чи завалу' },
                                                            { key: 'burn', icon: 'flame', label: 'Опік', desc: 'Термічний або хімічний опік шкіри та тканин' },
                                                            { key: 'laceration', icon: 'alert-triangle', label: 'Рвана рана', desc: 'Рвана, забійна або різана рана м’яких тканин' },
                                                            { key: 'contusion', icon: 'shield', label: 'Забій', desc: 'Закрите механічне ушкодження тканин без порушення цілісності шкіри' }
                                                        ];

                                                        if (selectedRegion === 'arm_l' || selectedRegion === 'arm_r') {
                                                            injuryOptions = [
                                                                { key: 'shrapnel', icon: 'crosshair', label: 'Уламкове', desc: 'Ураження уламками снарядів, мін, гранат, ВОГ або FPV-дронів' },
                                                                { key: 'bullet', icon: 'target', label: 'Кульове', desc: 'Вогнепальне кульове поранення руки' },
                                                                { key: 'amputation', icon: 'scissors', label: 'Ампутація руки', desc: 'Повний або неповний травматичний відрив верхньої кінцівки (вище кисті)' },
                                                                { key: 'amp_hand', icon: 'hand', label: 'Ампутація кисті', desc: 'Травматичний відрив або розтрощення кисті руки' },
                                                                { key: 'amp_fingers', icon: 'scissors', label: 'Ампутація пальців', desc: 'Травматичний відрив або розтрощення пальців руки' },
                                                                { key: 'fracture', icon: 'activity', label: 'Перелом', desc: 'Перелом плечової, променевої, ліктьової кістки або пальців' },
                                                                { key: 'rupture', icon: 'zap', label: 'Розрив', desc: 'Тяжке розтрощення та розрив м’яких тканин, м’язів і зв’язок' },
                                                                { key: 'burn', icon: 'flame', label: 'Опік', desc: 'Термічний або хімічний опік верхньої кінцівки' },
                                                                { key: 'laceration', icon: 'alert-triangle', label: 'Рвана рана', desc: 'Рвана або різана рана м’яких тканин руки' },
                                                                { key: 'contusion', icon: 'shield', label: 'Забій', desc: 'Забій, гематома або сильний удар верхньої кінцівки' }
                                                            ];
                                                        } else if (selectedRegion === 'leg_l' || selectedRegion === 'leg_r') {
                                                            injuryOptions = [
                                                                { key: 'shrapnel', icon: 'crosshair', label: 'Уламкове', desc: 'Ураження уламками снарядів, мін, гранат, ВОГ або FPV-дронів' },
                                                                { key: 'bullet', icon: 'target', label: 'Кульове', desc: 'Вогнепальне кульове поранення ноги' },
                                                                { key: 'amputation', icon: 'scissors', label: 'Ампутація ноги', desc: 'Повний або неповний травматичний відрив нижньої кінцівки (гомілка/стегно)' },
                                                                { key: 'amp_foot', icon: 'footprints', label: 'Ампутація стопи', desc: 'Травматичний відрив або руйнування стопи (підрив на міні ПМН)' },
                                                                { key: 'amp_fingers', icon: 'scissors', label: 'Ампутація пальців', desc: 'Травматичний відрив або розтрощення пальців стопи' },
                                                                { key: 'fracture', icon: 'activity', label: 'Перелом', desc: 'Перелом стегнової, великогомілкової кістки або стопи' },
                                                                { key: 'rupture', icon: 'zap', label: 'Розрив', desc: 'Тяжке розтрощення та розрив м’яких тканин, м’язів і сухожилків' },
                                                                { key: 'burn', icon: 'flame', label: 'Опік', desc: 'Термічний або хімічний опік нижньої кінцівки' },
                                                                { key: 'crush', icon: 'layers', label: 'Краш-синдром', desc: 'Синдром тривалого стиснення ноги (присипання в бліндажі/окопі, небезпека токсикозу нирок)' },
                                                                { key: 'contusion', icon: 'shield', label: 'Забій', desc: 'Забій, синець або масивна гематома ноги' }
                                                            ];
                                                        } else if (selectedRegion === 'head') {
                                                            injuryOptions = [
                                                                { key: 'shrapnel', icon: 'crosshair', label: 'Уламкове', desc: 'Уламкове поранення м’яких тканин голови або обличчя' },
                                                                { key: 'bullet', icon: 'target', label: 'Кульове', desc: 'Вогнепальне кульове поранення голови' },
                                                                { key: 'tbi', icon: 'brain', label: 'ЧМТ / Контузія / Струс', desc: 'Закрита/відкрита черепно-мозкова травма, струс або забій головного мозку' },
                                                                { key: 'eye', icon: 'eye', label: 'Травма ока', desc: 'Ураження очного яблука або орбіти уламками, склом, порохом' },
                                                                { key: 'akbt', icon: 'volume-2', label: 'АКБТ', desc: 'Акубаротравма (контузія слуху, різкий перепад тиску, шум у вухах)' },
                                                                { key: 'barotrauma', icon: 'wind', label: 'Баротравма', desc: 'Ураження органів слуху та носоглотки вибуховою хвилею' },
                                                                { key: 'fracture', icon: 'activity', label: 'Перелом', desc: 'Перелом кісток черепа, носа або щелепи' },
                                                                { key: 'burn', icon: 'flame', label: 'Опік', desc: 'Опік обличчя, голови чи очей' },
                                                                { key: 'laceration', icon: 'alert-triangle', label: 'Рвана рана', desc: 'Рвана рана волосистої частини голови або обличчя' },
                                                                { key: 'contusion', icon: 'shield', label: 'Забій', desc: 'Забій або гематома м’яких тканин голови' }
                                                            ];
                                                        } else if (selectedRegion === 'chest') {
                                                            injuryOptions = [
                                                                { key: 'shrapnel', icon: 'crosshair', label: 'Уламкове', desc: 'Проникаюче або непроникаюче уламкове поранення грудей' },
                                                                { key: 'bullet', icon: 'target', label: 'Кульове', desc: 'Кульове поранення грудної клітки' },
                                                                { key: 'pneumothorax', icon: 'heart-pulse', label: 'Пневмоторакс', desc: 'Скупчення повітря в плевральній порожнині, колапс легені (загроза життю)' },
                                                                { key: 'rupture', icon: 'zap', label: 'Розрив', desc: 'Розрив м’язів грудної стінки або діафрагми' },
                                                                { key: 'fracture', icon: 'activity', label: 'Перелом ребер', desc: 'Перелом ребер, ключиці або грудини' },
                                                                { key: 'burn', icon: 'flame', label: 'Опік', desc: 'Термічний або хімічний опік грудної клітки' },
                                                                { key: 'crush', icon: 'layers', label: 'Краш-синдром', desc: 'Здавлення грудної клітки завалом або ґрунтом (асфіксія, шок)' },
                                                                { key: 'contusion', icon: 'shield', label: 'Забій', desc: 'Тупа травма / забій грудної клітки, легень або серця' }
                                                            ];
                                                        } else if (selectedRegion === 'abdomen') {
                                                            injuryOptions = [
                                                                { key: 'shrapnel', icon: 'crosshair', label: 'Уламкове', desc: 'Проникаюче або сліпе уламкове поранення живота/тазу' },
                                                                { key: 'bullet', icon: 'target', label: 'Кульове', desc: 'Кульове поранення черевної порожнини' },
                                                                { key: 'rupture', icon: 'zap', label: 'Розрив', desc: 'Розрив внутрішніх органів (печінка, селезінка, кишківник)' },
                                                                { key: 'burn', icon: 'flame', label: 'Опік', desc: 'Термічний опік передньої черевної стінки' },
                                                                { key: 'laceration', icon: 'alert-triangle', label: 'Рвана рана', desc: 'Рвана рана м’яких тканин черевної стінки' },
                                                                { key: 'contusion', icon: 'shield', label: 'Забій', desc: 'Тупа травма живота, забій внутрішніх органів' }
                                                            ];
                                                        } else if (selectedRegion === 'neck') {
                                                            injuryOptions = [
                                                                { key: 'shrapnel', icon: 'crosshair', label: 'Уламкове', desc: 'Уламкове поранення шиї (ризик пошкодження сонної артерії, трахеї)' },
                                                                { key: 'bullet', icon: 'target', label: 'Кульове', desc: 'Кульове поранення шиї' },
                                                                { key: 'laceration', icon: 'alert-triangle', label: 'Рвана рана', desc: 'Рвана рана м’яких тканин шиї' },
                                                                { key: 'burn', icon: 'flame', label: 'Опік', desc: 'Термічний опік шиї' },
                                                                { key: 'fracture', icon: 'activity', label: 'Перелом', desc: 'Травма / перелом шийного відділу хребта чи гортані' },
                                                                { key: 'contusion', icon: 'shield', label: 'Забій', desc: 'Забій або гематома шиї' }
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
                                                                            className={`w-full flex items-center justify-between px-3 py-2 rounded-sm text-xs font-semibold transition-colors cursor-pointer select-none text-left ${
                                                                                isChecked
                                                                                    ? 'bg-[#d9534f]/15 border border-[#d9534f] text-[#e6edf3] font-bold'
                                                                                    : 'bg-[#101113] hover:bg-[#222429] border border-[#2e3138] hover:border-[#3c404a] text-[#b8bec8] hover:text-[#e6edf3]'
                                                                            }`}
                                                                        >
                                                                            <span className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                                                                                <Icon name={i.icon} className={`w-3.5 h-3.5 shrink-0 ${isChecked ? 'text-[#f3a3a0]' : 'text-[#989fa9]'}`} />
                                                                                <span className="text-xs font-semibold whitespace-normal leading-snug">{i.label}</span>
                                                                            </span>
                                                                            {isChecked ? (
                                                                                <span className="w-4 h-4 rounded-sm bg-[#d9534f] text-white flex items-center justify-center font-black text-[10px] shrink-0">
                                                                                    <Icon name="check" className="w-3 h-3" />
                                                                                </span>
                                                                            ) : (
                                                                                <span className="w-4 h-4 rounded-sm border border-[#3c404a] bg-[#17181b] shrink-0"></span>
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
                                <div className="px-5 py-3.5 bg-[#101113] border-t border-[#2e3138] flex items-center justify-between shrink-0">
                                    <div>
                                        {isEditOpen && (
                                            confirmDelete ? (
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-[#f3a3a0] font-bold">Дійсно видалити запис?</span>
                                                    <button type="button" onClick={handleDeleteEpisode} className="px-3.5 py-1.5 bg-[#d9534f] hover:bg-[#e06561] text-white text-xs font-bold rounded-sm border border-[#d9534f] transition-colors cursor-pointer">Так, видалити</button>
                                                    <button type="button" onClick={() => setConfirmDelete(false)} className="px-3.5 py-1.5 bg-[#222429] hover:bg-[#2e3138] text-[#b8bec8] text-xs font-semibold rounded-sm border border-[#3c404a] transition-colors cursor-pointer">Скасувати</button>
                                                </div>
                                            ) : (
                                                <button type="button" onClick={() => setConfirmDelete(true)} className="px-4 py-2 bg-[#d9534f]/10 hover:bg-[#d9534f]/20 text-[#f3a3a0] hover:text-white border border-[#d9534f]/45 text-xs font-bold rounded-sm transition-colors cursor-pointer flex items-center gap-1.5">
                                                    <Icon name="trash-2" className="w-3.5 h-3.5" />
                                                    <span>Видалити запис</span>
                                                </button>
                                            )
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button type="button" onClick={() => { setIsAddWoundedOpen(false); setIsEditOpen(false); }} className="px-4 py-2 bg-[#17181b] hover:bg-[#222429] text-[#b8bec8] hover:text-[#e6edf3] border border-[#2e3138] text-xs font-bold rounded-sm transition-colors cursor-pointer">
                                            Скасувати
                                        </button>
                                        <button type="submit" className="px-5 py-2 bg-[#2b67ab] hover:bg-[#3678c4] text-white border border-[#4c8ed9] text-xs font-bold rounded-sm transition-colors cursor-pointer flex items-center gap-2">
                                            <Icon name="check" className="w-4 h-4" />
                                            <span>{isEditOpen ? 'Оновити запис' : 'Зберегти запис'}</span>
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    )}

                    {/* Модальне вікно авто-відновлення з диска при порожній локальній базі */}
                    {showAutoRestoreModal && diskBackupInfo?.exists && (
                        <div className="fixed inset-0 z-[210] bg-black/80 flex items-center justify-center p-3 sm:p-4 overscroll-contain">
                            <div className="bg-[#17181b] border border-[#3da372]/50 w-full max-w-md rounded-sm overflow-hidden flex flex-col p-6 space-y-5">
                                <div className="flex items-center gap-3.5">
                                    <div className="w-11 h-11 rounded-sm bg-[#3da372]/15 border border-[#3da372]/40 flex items-center justify-center text-[#3da372] shrink-0">
                                        <Icon name="shield-check" className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-bold text-[#e6edf3] tracking-tight">Відновлення бази з диска</h3>
                                        <p className="text-xs text-[#989fa9]">Пам&apos;ять браузера порожня, але на ПК знайдено збережену базу.</p>
                                    </div>
                                </div>

                                <div className="bg-[#101113] border border-[#2e3138] rounded-sm p-3.5 text-xs space-y-2 tabular-nums">
                                    <div className="flex justify-between items-center">
                                        <span className="text-[#989fa9]">Файл на диску:</span>
                                        <span className="font-mono text-[#8ad8ae] font-bold">{diskBackupInfo.filename}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-[#989fa9]">Дата створення:</span>
                                        <span className="font-mono text-[#e7c574] font-semibold">{diskBackupInfo.formatted_time || '08.09.2026'}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-[#989fa9]">Розташування:</span>
                                        <span className="font-mono text-[#b8bec8] text-[11px]">d:\ОЧ\Програми\_backups</span>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-[#e6edf3]">Пароль для розшифрування бази:</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#989fa9]">
                                            <Icon name="key-round" className="w-4 h-4" />
                                        </div>
                                        <input
                                            type="password"
                                            autoFocus
                                            value={diskRestorePassword}
                                            onChange={(e) => setDiskRestorePassword(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') handleRestoreFromDisk(); }}
                                            placeholder="Введіть ваш пароль бекапу..."
                                            className="w-full bg-[#101113] border border-[#2e3138] focus:border-[#3da372] rounded-sm pl-10 pr-4 py-2.5 text-xs text-[#e6edf3] placeholder-[#989fa9] outline-none transition-colors font-sans"
                                        />
                                    </div>
                                </div>

                                <div className="flex gap-2.5 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => setShowAutoRestoreModal(false)}
                                        className="flex-1 py-2.5 bg-[#17181b] hover:bg-[#222429] border border-[#2e3138] text-[#b8bec8] hover:text-[#e6edf3] font-medium rounded-sm text-xs transition-colors cursor-pointer"
                                    >
                                        Пропустити
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleRestoreFromDisk()}
                                        disabled={isRestoringFromDisk}
                                        className="flex-1 py-2.5 bg-[#3da372] hover:bg-[#4ab883] border border-[#3da372] text-[#0b1410] font-bold rounded-sm text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                                    >
                                        <Icon name="refresh-cw" className={`w-3.5 h-3.5 ${isRestoringFromDisk ? 'animate-spin' : ''}`} />
                                        <span>Відновити дані</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {isBackupOpen && (
                        <div onClick={(e) => { if (e.target === e.currentTarget) setIsBackupOpen(false); }} className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-3 sm:p-4 overscroll-contain">
                            <div className="bg-[#17181b] border border-[#2e3138] w-full max-w-xl rounded-sm overflow-hidden flex flex-col">
                                {/* Header */}
                                <div className="px-5 py-3.5 bg-[#101113] border-b border-[#2e3138] flex justify-between items-center">
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-sm bg-[#4c8ed9]/15 border border-[#4c8ed9]/40 flex items-center justify-center text-[#4c8ed9] shrink-0">
                                            <Icon name="shield-check" className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-[#e6edf3] text-base tracking-tight">Резервні копії та база</h3>
                                            <p className="text-[11px] text-[#989fa9]">Шифрований експорт AES-256, цілісність та керування базою</p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsBackupOpen(false)}
                                        className="w-8 h-8 rounded-sm bg-[#17181b] hover:bg-[#222429] border border-[#2e3138] text-[#b8bec8] hover:text-[#e6edf3] flex items-center justify-center transition-colors cursor-pointer"
                                    >
                                        <Icon name="x" className="w-4 h-4" />
                                    </button>
                                </div>

                                <div className="p-5 space-y-4 overflow-y-auto max-h-[80vh]">
                                    {/* 1. Експорт */}
                                    <div className="bg-[#101113] border border-[#2e3138] hover:border-[#3da372]/50 rounded-sm p-4 space-y-3 transition-colors">
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-sm bg-[#3da372]/15 border border-[#3da372]/40 flex items-center justify-center text-[#3da372]">
                                                    <Icon name="download" className="w-4 h-4" />
                                                </div>
                                                <span className="text-xs font-bold text-[#8ad8ae] uppercase tracking-wider">Створити резервну копію (Експорт)</span>
                                            </div>
                                            <span className="text-[10px] font-mono text-[#8ad8ae] bg-[#3da372]/15 border border-[#3da372]/40 px-2 py-0.5 rounded-sm font-bold">AES-256</span>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="relative">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#989fa9]">
                                                    <Icon name="lock" className="w-3.5 h-3.5" />
                                                </div>
                                                <input
                                                    type="password"
                                                    value={backupPassword}
                                                    onChange={(e) => setBackupPassword(e.target.value)}
                                                    placeholder="Придумайте пароль для захисту файлу..."
                                                    className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#3da372] rounded-sm pl-9 pr-3 py-2 text-xs text-[#e6edf3] placeholder-[#989fa9] outline-none transition-colors font-sans"
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleExport}
                                                className="w-full py-2.5 bg-[#3da372] hover:bg-[#4ab883] text-[#0b1410] border border-[#3da372] font-bold rounded-sm text-xs transition-colors cursor-pointer flex items-center justify-center gap-2"
                                            >
                                                <Icon name="download" className="w-4 h-4" />
                                                <span>Завантажити зашифрований .enc файл</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* 2. Імпорт */}
                                    <div className="bg-[#101113] border border-[#2e3138] hover:border-[#4c8ed9]/50 rounded-sm p-4 space-y-3 transition-colors">
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-sm bg-[#4c8ed9]/15 border border-[#4c8ed9]/40 flex items-center justify-center text-[#4c8ed9]">
                                                    <Icon name="upload" className="w-4 h-4" />
                                                </div>
                                                <span className="text-xs font-bold text-[#9bc5f4] uppercase tracking-wider">Відновити з файлу (Імпорт)</span>
                                            </div>
                                            <span className="text-[10px] font-mono text-[#9bc5f4] bg-[#4c8ed9]/15 border border-[#4c8ed9]/40 px-2 py-0.5 rounded-sm font-bold">.ENC</span>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex items-center w-full bg-[#17181b] border border-[#2e3138] rounded-sm p-1.5">
                                                <input
                                                    type="file"
                                                    accept=".enc"
                                                    onChange={handleFileChange}
                                                    className="w-full text-xs text-[#b8bec8] outline-none file:mr-3 file:py-1.5 file:px-3 file:rounded-sm file:border file:border-[#3c404a] file:text-xs file:font-semibold file:bg-[#222429] file:text-[#e6edf3] hover:file:bg-[#2e3138] cursor-pointer"
                                                />
                                            </div>
                                            <div className="relative">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#989fa9]">
                                                    <Icon name="key-round" className="w-3.5 h-3.5" />
                                                </div>
                                                <input
                                                    type="password"
                                                    value={importPassword}
                                                    onChange={(e) => setImportPassword(e.target.value)}
                                                    placeholder="Пароль для розшифрування файлу..."
                                                    className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm pl-9 pr-3 py-2 text-xs text-[#e6edf3] placeholder-[#989fa9] outline-none transition-colors font-sans"
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleImport}
                                                className="w-full py-2.5 bg-[#2b67ab] hover:bg-[#3678c4] text-white border border-[#4c8ed9] font-bold rounded-sm text-xs transition-colors cursor-pointer flex items-center justify-center gap-2"
                                            >
                                                <Icon name="refresh-cw" className="w-4 h-4" />
                                                <span>Розшифрувати та відновити базу</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* 3. Data Integrity Guard (Діагностика та лікування бази) */}
                                    <div className="bg-[#101113] border border-[#2e3138] hover:border-[#d99b26]/50 rounded-sm p-4 space-y-3 transition-colors">
                                        <div className="flex justify-between items-center flex-wrap gap-2">
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-sm bg-[#d99b26]/15 border border-[#d99b26]/40 flex items-center justify-center text-[#e7c574]">
                                                    <Icon name="shield-alert" className="w-4 h-4" />
                                                </div>
                                                <span className="text-xs font-bold text-[#e7c574] uppercase tracking-wider">Data Integrity Guard (Цілісність бази)</span>
                                            </div>
                                            <span className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-sm border flex items-center gap-1.5 tabular-nums ${
                                                !integrityStatus.checked 
                                                    ? 'bg-[#17181b] text-[#989fa9] border-[#2e3138]'
                                                    : integrityStatus.isHealthy
                                                        ? 'bg-[#3da372]/15 text-[#8ad8ae] border-[#3da372]/45'
                                                        : 'bg-[#d99b26]/15 text-[#e7c574] border-[#d99b26]/45'
                                            }`}>
                                                {integrityStatus.checked && (
                                                    <span className={`w-1.5 h-1.5 rounded-full ${integrityStatus.isHealthy ? 'bg-[#3da372]' : 'bg-[#d99b26]'}`}></span>
                                                )}
                                                <span>{!integrityStatus.checked ? 'Статус: Не перевірено' : (integrityStatus.isHealthy ? '100% Цілісність' : `Зауважень: ${integrityStatus.issueCount}`)}</span>
                                            </span>
                                        </div>

                                        <p className="text-[11px] text-[#989fa9] leading-relaxed">
                                            Автоматичний захист від сирітських записів, пошкоджених дат та аварійних помилок синхронізації.
                                        </p>

                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                                            <button
                                                type="button"
                                                onClick={() => handleRunIntegrityDiagnosis(false)}
                                                className="py-2 px-3 bg-[#17181b] hover:bg-[#222429] text-[#b8bec8] hover:text-[#e6edf3] border border-[#2e3138] hover:border-[#3c404a] font-semibold rounded-sm text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                                            >
                                                <Icon name="search" className="w-3.5 h-3.5 text-[#e7c574]" />
                                                <span>Діагностика</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => handleRunIntegrityDiagnosis(true)}
                                                className="py-2 px-3 bg-[#d99b26]/15 hover:bg-[#d99b26]/25 text-[#e7c574] hover:text-[#f3d88e] border border-[#d99b26]/45 font-bold rounded-sm text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                                            >
                                                <Icon name="check-circle" className="w-3.5 h-3.5 text-[#d99b26]" />
                                                <span>Полікувати базу</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={handleStandardizeAllCallsigns}
                                                className="py-2 px-3 bg-[#17181b] hover:bg-[#222429] text-[#e7c574] hover:text-[#f3d88e] border border-[#d99b26]/40 font-bold rounded-sm text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                                                title="Привести всі позивні в базі до єдиного стандарту Title Case («Сокіл», «Тайфун»)"
                                            >
                                                <Icon name="sparkles" className="w-3.5 h-3.5 text-[#d99b26]" />
                                                <span>Стандартизувати позивні</span>
                                            </button>
                                        </div>

                                        {/* Детальний список знайдених зауважень */}
                                        {integrityStatus.checked && integrityStatus.details && integrityStatus.details.length > 0 && (
                                            <div className="pt-2.5 border-t border-[#2e3138] space-y-2">
                                                <div className="flex items-center justify-between text-[11px] font-bold text-[#e7c574]">
                                                    <span className="flex items-center gap-1.5">
                                                        <Icon name="alert-circle" className="w-3.5 h-3.5 text-[#d99b26]" />
                                                        <span className="tabular-nums">Виявлені невідповідності ({integrityStatus.details.length}):</span>
                                                    </span>
                                                </div>
                                                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                                                    {integrityStatus.details.map((item, idx) => {
                                                        const text = typeof item === 'string' ? item : item.text;
                                                        const ep = item && typeof item === 'object' ? item.episode : null;
                                                        return (
                                                            <div key={idx} className="p-2 bg-[#17181b] rounded-sm border border-[#d99b26]/40 text-[11px] font-mono text-[#e6edf3] flex items-center justify-between gap-2 tabular-nums">
                                                                <div className="flex items-start gap-2 overflow-hidden">
                                                                    <span className="text-[#e7c574] font-bold shrink-0">#{idx + 1}</span>
                                                                    <span className="leading-tight select-text break-words">{text}</span>
                                                                </div>
                                                                {ep && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setIsBackupOpen(false);
                                                                            handleStartEdit(ep);
                                                                        }}
                                                                        className="px-2.5 py-1 bg-[#d99b26]/15 hover:bg-[#d99b26] text-[#e7c574] hover:text-[#101113] border border-[#d99b26]/45 font-bold rounded-sm text-[11px] transition-colors cursor-pointer flex items-center gap-1 shrink-0"
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
                                            <div className="pt-2 border-t border-[#2e3138] flex items-center justify-between">
                                                <span className="text-[10px] font-mono text-[#989fa9] flex items-center gap-1">
                                                    <Icon name="history" className="w-3 h-3 text-[#989fa9]" />
                                                    <span>Є аварійний знімок</span>
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={handleRestoreSnapshot}
                                                    className="text-[11px] text-[#4c8ed9] hover:text-[#9bc5f4] font-semibold cursor-pointer hover:underline flex items-center gap-1"
                                                >
                                                    <Icon name="rotate-ccw" className="w-3 h-3" />
                                                    <span>Відновити з останнього знімка</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* 3. Небезпечна зона */}
                                    <div className="bg-[#d9534f]/10 border border-[#d9534f]/40 rounded-sm p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div className="space-y-0.5">
                                            <div className="text-xs font-bold text-[#f3a3a0] uppercase flex items-center gap-1.5">
                                                <Icon name="alert-triangle" className="w-4 h-4 text-[#f3a3a0]" />
                                                <span>Небезпечна зона</span>
                                            </div>
                                            <p className="text-[11px] text-[#b8bec8]">Повне або вибіркове скидання бази даних (можна залишити СЗЧ та обрані записи)</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setClearKeepAwol(false);
                                                setClearKeepUnevac200(false);
                                                setClearKeepEpisodeIds([]);
                                                setClearSearchTerm("");
                                                setIsClearDbConfirmOpen(true);
                                            }}
                                            className="px-4 py-2 bg-[#d9534f]/20 hover:bg-[#d9534f] border border-[#d9534f] text-[#f3a3a0] hover:text-white font-bold rounded-sm text-xs transition-colors cursor-pointer shrink-0"
                                        >
                                            Очистити базу
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {isClearDbConfirmOpen && (() => {
                        const awolEps = episodes.filter(ep => isAwol(ep.lossType));
                        const unevac200Eps = episodes.filter(ep => isAny200(ep.lossType) && ep.evacStatus === "Не евакуйований");
                        const nonAwolEps = [...episodes.filter(ep => !isAwol(ep.lossType))].sort((a, b) => parseSafeDate(b.date) - parseSafeDate(a.date));
                        const latest300 = nonAwolEps.find(ep => isAny300(ep.lossType));
                        const q = clearSearchTerm.trim().toLowerCase();
                        const filteredNonAwol = q ? nonAwolEps.filter(ep => {
                            const s = MedicalPersonnelDirectory.forEpisode(ep, soldiersMap.get(ep.soldierId));
                            const hay = `${s?.name || ''} ${s?.callsign || ''} ${s?.unit || ep.unit || ''} ${ep.lossType || ''} ${ep.evacStatus || ''} ${ep.date || ''}`.toLowerCase();
                            return hay.includes(q);
                        }) : nonAwolEps;
                        const keepIdsSet = new Set(clearKeepEpisodeIds);
                        const actualKeptEps = episodes.filter(ep =>
                            (clearKeepAwol && isAwol(ep.lossType)) ||
                            (clearKeepUnevac200 && isAny200(ep.lossType) && ep.evacStatus === "Не евакуйований") ||
                            keepIdsSet.has(ep.id)
                        );
                        const keptCount = actualKeptEps.length;
                        const removedCount = Math.max(0, episodes.length - keptCount);

                        return (
                            <div onClick={(e) => { if (e.target === e.currentTarget) setIsClearDbConfirmOpen(false); }} className="fixed inset-0 z-[210] bg-black/80 flex items-center justify-center p-4 overscroll-contain">
                                <div className="bg-[#17181b] border border-[#d9534f]/60 w-full max-w-lg rounded-sm overflow-hidden flex flex-col max-h-[90vh]">
                                    <div className="px-5 py-3.5 bg-[#101113] border-b border-[#d9534f]/40 flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2.5">
                                            <Icon name="alert-octagon" className="w-5 h-5 text-[#f3a3a0] shrink-0" />
                                            <div className="text-left">
                                                <h3 className="font-bold text-[#e6edf3] text-sm sm:text-base">Очищення бази даних</h3>
                                                <p className="text-[11px] text-[#f3a3a0]">Оберіть записи, які потрібно зберегти, або очистіть усе</p>
                                            </div>
                                        </div>
                                        <button type="button" onClick={() => setIsClearDbConfirmOpen(false)} className="w-7 h-7 rounded-sm bg-[#17181b] hover:bg-[#222429] border border-[#2e3138] text-[#b8bec8] hover:text-[#e6edf3] flex items-center justify-center cursor-pointer transition-colors">
                                            <Icon name="x" className="w-4 h-4" />
                                        </button>
                                    </div>

                                    <div className="p-4 sm:p-5 overflow-y-auto space-y-3 text-left flex-1">
                                        {/* Швидкі пресети */}
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setClearKeepAwol(true);
                                                    setClearKeepUnevac200(true);
                                                    setClearKeepEpisodeIds(latest300 ? [latest300.id] : []);
                                                }}
                                                className="px-3 py-1.5 rounded-sm bg-[#3da372]/15 hover:bg-[#3da372]/25 border border-[#3da372]/45 text-[#8ad8ae] text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
                                            >
                                                <Icon name="check-circle" className="w-3.5 h-3.5 text-[#3da372]" />
                                                <span>Залишити СЗЧ + неевак. 200 + 1 поранення</span>
                                            </button>
                                            {(clearKeepAwol || clearKeepUnevac200 || clearKeepEpisodeIds.length > 0) && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setClearKeepAwol(false);
                                                        setClearKeepUnevac200(false);
                                                        setClearKeepEpisodeIds([]);
                                                    }}
                                                    className="px-3 py-1.5 rounded-sm bg-[#101113] hover:bg-[#222429] border border-[#2e3138] text-[#b8bec8] hover:text-[#e6edf3] text-xs font-semibold transition-colors cursor-pointer"
                                                >
                                                    Скинути вибір (видалити все)
                                                </button>
                                            )}
                                        </div>

                                        {/* Опція 1: Залишити СЗЧ */}
                                        <label className={`flex items-center justify-between gap-3 p-3 rounded-sm border cursor-pointer transition-colors select-none ${clearKeepAwol ? 'bg-[#8f5fb8]/15 border-[#8f5fb8]/55 text-[#e6edf3]' : 'bg-[#101113] border-[#2e3138] text-[#b8bec8] hover:border-[#3c404a]'}`}>
                                            <div className="flex items-center gap-2.5">
                                                <input
                                                    type="checkbox"
                                                    checked={clearKeepAwol}
                                                    onChange={(e) => setClearKeepAwol(e.target.checked)}
                                                    className="w-4 h-4 rounded-sm bg-[#17181b] border-[#3c404a] text-[#8f5fb8] focus:ring-0 cursor-pointer"
                                                />
                                                <div>
                                                    <div className="text-xs font-bold">Залишити всі записи обліку СЗЧ</div>
                                                    <div className="text-[10px] text-[#989fa9]">СЗЧ, Повернення з СЗЧ та Дезертирство</div>
                                                </div>
                                            </div>
                                            <span className="px-2 py-0.5 rounded-sm bg-[#8f5fb8]/20 border border-[#8f5fb8]/45 text-[#d8b4fe] font-mono text-xs font-bold shrink-0 tabular-nums">
                                                {awolEps.length} зап.
                                            </span>
                                        </label>

                                        {/* Опція 2: Залишити неевакуйованих 200 */}
                                        <label className={`flex items-center justify-between gap-3 p-3 rounded-sm border cursor-pointer transition-colors select-none ${clearKeepUnevac200 ? 'bg-[#222429] border-[#566173] text-[#e6edf3]' : 'bg-[#101113] border-[#2e3138] text-[#b8bec8] hover:border-[#3c404a]'}`}>
                                            <div className="flex items-center gap-2.5">
                                                <input
                                                    type="checkbox"
                                                    checked={clearKeepUnevac200}
                                                    onChange={(e) => setClearKeepUnevac200(e.target.checked)}
                                                    className="w-4 h-4 rounded-sm bg-[#17181b] border-[#3c404a] text-[#4c8ed9] focus:ring-0 cursor-pointer"
                                                />
                                                <div>
                                                    <div className="text-xs font-bold">Залишити всіх неевакуйованих 200</div>
                                                    <div className="text-[10px] text-[#989fa9]">Загибель (200), 200 (від ран), Небойова смерть (200) зі статусом «Не евакуйований»</div>
                                                </div>
                                            </div>
                                            <span className="px-2 py-0.5 rounded-sm bg-[#17181b] border border-[#3c404a] text-[#e6edf3] font-mono text-xs font-bold shrink-0 tabular-nums">
                                                {unevac200Eps.length} зап.
                                            </span>
                                        </label>

                                        {/* Опція 3: Вибір записів з Втрат о/с */}
                                        <div className="bg-[#101113] border border-[#2e3138] rounded-sm p-3 space-y-2.5">
                                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                                <span className="text-xs font-bold text-[#e6edf3] tabular-nums">
                                                    Додатково залишити з «Втрат о/с» ({clearKeepEpisodeIds.length} обрано)
                                                </span>
                                                <div className="flex items-center gap-1.5">
                                                    {latest300 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setClearKeepEpisodeIds([latest300.id])}
                                                            className="px-2 py-0.5 rounded-sm bg-[#d99b26]/15 hover:bg-[#d99b26]/25 border border-[#d99b26]/45 text-[#e7c574] text-[10px] font-mono font-bold cursor-pointer transition-colors"
                                                        >
                                                            1 останній 300
                                                        </button>
                                                    )}
                                                    {clearKeepEpisodeIds.length > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setClearKeepEpisodeIds([])}
                                                            className="px-2 py-0.5 rounded-sm bg-[#17181b] hover:bg-[#222429] border border-[#2e3138] text-[#b8bec8] text-[10px] font-mono cursor-pointer transition-colors"
                                                        >
                                                            Зняти
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {nonAwolEps.length > 0 ? (
                                                <>
                                                    <input
                                                        type="text"
                                                        value={clearSearchTerm}
                                                        onChange={(e) => setClearSearchTerm(e.target.value)}
                                                        placeholder="Пошук запису за ПІБ, позивним або типом..."
                                                        className="w-full bg-[#17181b] border border-[#2e3138] focus:border-[#4c8ed9] rounded-sm px-2.5 py-1.5 text-xs text-[#e6edf3] placeholder-[#989fa9] outline-none"
                                                    />
                                                    <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                                                        {filteredNonAwol.map(ep => {
                                                            const s = MedicalPersonnelDirectory.forEpisode(ep, soldiersMap.get(ep.soldierId));
                                                            const isAuto200 = clearKeepUnevac200 && isAny200(ep.lossType) && ep.evacStatus === "Не евакуйований";
                                                            const checked = isAuto200 || clearKeepEpisodeIds.includes(ep.id);
                                                            return (
                                                                <label key={ep.id} className={`flex items-center justify-between gap-2 p-2 rounded-sm border text-xs cursor-pointer transition-colors select-none ${checked ? 'bg-[#3da372]/15 border-[#3da372]/50 text-[#e6edf3]' : 'bg-[#17181b] border-[#2e3138] text-[#b8bec8] hover:bg-[#222429]'}`}>
                                                                    <div className="flex items-center gap-2 min-w-0">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={checked}
                                                                            disabled={isAuto200}
                                                                            onChange={() => {
                                                                                setClearKeepEpisodeIds(prev => prev.includes(ep.id) ? prev.filter(id => id !== ep.id) : [...prev, ep.id]);
                                                                            }}
                                                                            className="w-3.5 h-3.5 rounded-sm bg-[#101113] border-[#3c404a] text-[#3da372] focus:ring-0 cursor-pointer shrink-0 disabled:opacity-60"
                                                                        />
                                                                        <div className="truncate">
                                                                            <span className="font-bold text-[#e6edf3]">{s?.name || 'Невідомий'}</span>
                                                                            {s?.callsign && <span className="text-[#e7c574] font-mono ml-1">«{formatCallsignUI(s.callsign)}»</span>}
                                                                            <span className="text-[10px] text-[#989fa9] font-mono ml-1.5">({s?.unit || ep.unit || '—'})</span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="text-right shrink-0 font-mono text-[10px] tabular-nums">
                                                                        <div className={isAny300(ep.lossType) ? 'text-[#e7c574] font-bold' : 'text-[#b8bec8]'}>{ep.lossType}{ep.severity ? ` · ${ep.severity}` : ''}</div>
                                                                        <div className="text-[#989fa9]">{formatEpisodeDateUI(ep.date)} · <span className={ep.evacStatus === 'Не евакуйований' ? 'text-[#f3a3a0]' : 'text-[#8ad8ae]'}>{ep.evacStatus}</span></div>
                                                                    </div>
                                                                </label>
                                                            );
                                                        })}
                                                    </div>
                                                </>
                                            ) : (
                                                <p className="text-[11px] text-[#989fa9] italic">Записів у «Втратах о/с» немає.</p>
                                            )}
                                        </div>

                                        {/* Підсумок перед дією */}
                                        <div className={`p-3 rounded-sm border text-xs tabular-nums ${keptCount > 0 ? 'bg-[#d99b26]/10 border-[#d99b26]/45 text-[#e7c574]' : 'bg-[#d9534f]/10 border-[#d9534f]/45 text-[#f3a3a0]'}`}>
                                            {keptCount > 0 ? (
                                                <div className="space-y-1">
                                                    <div><strong>Залишиться в базі:</strong> {keptCount} епізод(ів) (СЗЧ: {clearKeepAwol ? awolEps.length : 0}, Неевак. 200: {clearKeepUnevac200 ? unevac200Eps.length : 0}, Інші обрані: {clearKeepEpisodeIds.filter(id => !(clearKeepUnevac200 && unevac200Eps.some(e => e.id === id))).length}).</div>
                                                    <div><strong>Буде видалено:</strong> {removedCount} епізод(ів) та анкети бійців без збережених подій.</div>
                                                    <div className="text-[10px] text-[#989fa9] pt-0.5">Перед очищенням автоматично створюється аварійний знімок (можна скасувати через Ctrl+Z або «Відновити з останнього знімка»).</div>
                                                </div>
                                            ) : (
                                                <div>
                                                    Це видалить <strong>усіх військовослужбовців ({soldiers.length}) та всі події ({episodes.length})</strong>. Автоматичний аварійний знімок буде збережено перед очищенням.
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="px-5 py-3.5 bg-[#101113] border-t border-[#2e3138] flex gap-3 justify-end">
                                        <button type="button" onClick={() => setIsClearDbConfirmOpen(false)} className="px-4 py-2 bg-[#17181b] hover:bg-[#222429] border border-[#2e3138] text-[#e6edf3] text-xs font-bold rounded-sm transition-colors cursor-pointer">Скасувати</button>
                                        <button type="button" onClick={handleClearDatabase} className="px-4 py-2 bg-[#d9534f] hover:bg-[#e06561] text-white border border-[#d9534f] text-xs font-bold rounded-sm transition-colors cursor-pointer tabular-nums">
                                            {keptCount > 0 ? `Очистити інше (залишити ${keptCount})` : 'Так, очистити все'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Плаваюча кнопка швидкого повернення нагору */}
                    <button 
                        id="btn-scroll-top" 
                        type="button" 
                        onClick={() => {
                            const scroller = document.querySelector('[data-suite-module="med"]') || window;
                            scroller.scrollTo({ top: 0, behavior: 'smooth' });
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                        }} 
                        title="Повернутися нагору (Top)"
                    >
                        ▲
                    </button>
                </div>
            );
        }
            return App;
        })();
        
        // Selected documentary registers adapted from «Оперативний журнал (1)».
        // Isolated storage and an explicit sheet allowlist: no other source modules are loaded.

export { MedicalApp };
