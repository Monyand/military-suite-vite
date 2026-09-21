import * as ReactDOM from 'react-dom';
import * as lucideModule from 'lucide';
import Chart from 'chart.js/auto';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import ExcelJS from 'exceljs';
import CryptoJS from 'crypto-js';
import localforage from 'localforage';
import * as XLSX from 'xlsx';

// The old UMD build supplied its icon set implicitly; the ESM API requires it.
const lucide = { ...lucideModule, createIcons: (options = {}) => lucideModule.createIcons({ icons: lucideModule.icons, ...options }) };

// Compatibility bridge for the original DOM journal and existing window checks.
// Application dependencies use explicit imports; no CDN script loading occurs.
Object.assign(window, { lucide, Chart, ChartDataLabels, ExcelJS, CryptoJS, localforage, XLSX });

export { ReactDOM, lucide, Chart, ChartDataLabels, ExcelJS, CryptoJS, localforage, XLSX };
