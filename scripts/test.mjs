import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const core = ['suite-html-provenance', 'suite-backup-unit', 'suite-document-journal', 'suite-medical-totals', 'suite-personnel-directory', 'suite-medical-series-unit', 'suite-position-register', 'suite-shared-dictionaries', 'suite-position-workflows', 'suite-position-inputs', 'suite-assault-report', 'suite-ovt-templates', 'suite-review-regressions'];
const browser = ['suite-html-base-ui', 'suite-navigation-filters', 'suite-selected-fixes', 'suite-controls-backup', 'suite-merge-audit', 'suite-medical-series-ui', 'suite-position-register-ui', 'suite-shared-dictionaries-ui', 'suite-position-workflows-ui', 'suite-position-inputs-ui', 'suite-assault-report-ui', 'suite-ovt-templates-ui'];
core.push('suite-local-time');
core.push('suite-medical-improvements');
core.push('suite-medical-workbook');
core.push('suite-pbd-options');
browser.push('suite-review-ui');
browser.push('suite-medical-improvements-ui');
browser.push('suite-medical-workbook-ui');
browser.push('suite-pbd-options-ui');
for (const name of process.argv.includes('--browser') ? browser : core) {
  const result = spawnSync(process.execPath, ['tests/' + name + '.cjs'], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
