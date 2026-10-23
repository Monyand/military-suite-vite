const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const output = path.join(__dirname, '../test-results/portable-copy');
  fs.mkdirSync(output, { recursive: true });
  const copy = path.join(output, 'MilitarySuite.html');
  fs.copyFileSync(path.join(__dirname, '../dist-single/MilitarySuite.html'), copy);
  assert.deepEqual(fs.readdirSync(output), ['MilitarySuite.html'], 'Portable folder must contain only the HTML');
  const url = pathToFileURL(copy).href;
  const browser = await chromium.launch({ channel: process.env.SUITE_BROWSER || 'msedge', headless: true });
  try {
    const context = await browser.newContext({ offline: true, viewport: { width: 1600, height: 1000 } });
    const errors = [], dependencies = [];
    await context.route('**/*', route => {
      const request = route.request();
      if (request.url() === url || /^(data:|blob:)/.test(request.url())) return route.continue();
      // The existing optional local-disk helper is not needed for browser storage.
      if (!request.url().startsWith('http://127.0.0.1:8765/') && !request.url().startsWith('http://127.0.0.1:8780/')) dependencies.push(request.url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const ready = () => page.getByRole('heading', { name: 'Стрічка подій', exact: true }).waitFor({ timeout: 30000 });
    await page.goto(url, { waitUntil: 'networkidle' }); await ready();
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    assert.equal(await page.evaluate(() => window.isSecureContext && !!crypto.subtle), true);
    assert.equal(await page.evaluate(() => document.querySelectorAll('script[src], link[href]').length), 0);
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => [...document.fonts].some(font => font.status === 'loaded')));
    await page.evaluate(async () => {
      await SuiteRuntime.setItem('document_single_file_test', { text: 'Синтетичні дані', number: 42 });
      SuiteRuntime.setLocalItem('tactical_single_file_test', 'settings survive reload');
    });
    await page.reload({ waitUntil: 'networkidle' }); await ready();
    assert.deepEqual(await page.evaluate(() => localforage.getItem('document_single_file_test')), { text: 'Синтетичні дані', number: 42 });
    assert.equal(await page.evaluate(() => localStorage.getItem('tactical_single_file_test')), 'settings survive reload');
    await page.screenshot({ path: path.join(__dirname, '../test-results/single-file-offline.png'), animations: 'disabled' });
    assert.deepEqual(errors, []); assert.deepEqual(dependencies, []);
    console.log('PASS: copied HTML alone starts offline via file://; fonts, Web Crypto, IndexedDB/localStorage and reload work; no external asset dependencies or uncaught errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
