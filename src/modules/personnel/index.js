import shell from './shell.html?raw';

export function mountPersonnelShell() {
  if (document.getElementById('app-tactical-container')) return;
  const template = document.createElement('template');
  // Static project-owned markup only; never user records or imported documents.
  template.innerHTML = shell;
  document.body.append(template.content);
}

export { createPersonnelModule } from './personnel.js';
