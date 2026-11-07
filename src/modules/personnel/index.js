import shell from './shell.html?raw';

export function mountPersonnelShell() {
  if (document.getElementById('app-tactical-container')) {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.classList.remove('top-4');
      toast.classList.add('top-16');
    }
    const banner = document.getElementById('target-mode-banner');
    if (banner) {
      banner.classList.remove('top-0');
      banner.classList.add('top-14');
    }
    return;
  }
  const template = document.createElement('template');
  // Static project-owned markup only; never user records or imported documents.
  template.innerHTML = shell;
  document.body.append(template.content);
}

export { createPersonnelModule } from './personnel.js';
