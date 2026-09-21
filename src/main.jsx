import './core/vendor.js';
import './core/runtime.js';
import './styles/app.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import { createRoot } from 'react-dom/client';
import { loadModules } from './app/loadModules.js';
import { RootApp } from './app/App.jsx';
import { SharedDictionaries } from './core/dictionary-service.js';

// No StrictMode while the legacy DOM journal has imperative startup effects.
SharedDictionaries.initialize().then(() => loadModules()).then(modules => {
  createRoot(document.getElementById('root')).render(<RootApp {...modules} />);
}).catch(error => {
  console.error('Не вдалося завантажити модулі', error);
  const root = document.getElementById('root');
  root.textContent = import.meta.env.MODE === 'single'
    ? 'Не вдалося завантажити програму. Перевірте цілісність HTML-файлу та відкрийте його в дозволеному сучасному браузері. Дані не видалено.'
    : 'Не вдалося завантажити програму. Перевірте, чи запущено локальний сервер, і перезавантажте сторінку. Дані не видалено.';
});
