const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const address = process.env.SUITE_TEST_URL || 'http://127.0.0.1:5173';
  const origin = new URL(address).origin;
  const browser = await chromium.launch({ channel: process.env.SUITE_BROWSER || 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1700, height: 1100 }, offline: process.env.SUITE_TEST_OFFLINE === '1' });
    const errors = [], external = [];
    await context.route('**/*', route => {
      const url = route.request().url();
      if (/^https?:/.test(url) && new URL(url).origin !== origin) {
        if (!url.startsWith('http://127.0.0.1:8765/')) external.push(url);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(25000);
    page.on('pageerror', error => errors.push(error.message));
    const ready = () => page.getByRole('heading', { name: 'Стрічка подій', exact: true }).waitFor();
    const top = title => page.getByRole('button', { name: title, exact: true }).first().click();
    await page.goto(address, { waitUntil: 'networkidle' }); await ready();
    const missing = await page.evaluate(refs => refs.filter(([name]) => !(name in window)), [...require('./source-audit.cjs').references()]);
    assert.deepEqual(missing, []);
    assert.equal(await page.getByTestId('save-status').count(), 0, 'Do not add the later save-status feature');
    assert.equal(await page.evaluate(() => localforage.getItem('document_suite_schema_v1')), null, 'Do not add the later schema migration gate');
    const output = path.join(__dirname, '../test-results'); fs.mkdirSync(output, { recursive: true });
    for (const [name, file] of [['Медична Евакуація', 'medical'], ['Журнал О/С', 'personnel'], ['Завдання', 'documents'], ['Втрати ОВТ', 'ovt'], ['Статус позицій', 'positions'], ['Втрати Противника', 'events']]) {
      await top(name);
      await page.waitForFunction(() => [...document.querySelectorAll('[data-suite-active="false"] button')].every(button => getComputedStyle(button).visibility === 'hidden'));
      await page.screenshot({ path: path.join(output, file + '.png'), animations: 'disabled' });
    }
    const person = { id: 'synthetic-roster', fullName: 'Тестова Анкета Джерела', callsign: 'Макет', rank: 'Сержант', unit: 'Тестовий підрозділ', status: 'ok', currentTask: 'піхота', deploymentStartTime: null };
    const medical = { id: 'synthetic-med', name: person.fullName, callsign: person.callsign, rank: 'Солдат', unit: 'Старий підрозділ' };
    const episode = { id: 'synthetic-old', soldierId: medical.id, date: '2026-09-10T10:00', lossType: 'Поранення (300)', severity: 'Легкий', cause: 'Інше', injuries: {}, evacStatus: 'Евакуйований', rank: medical.rank, unit: medical.unit, actualLoc: '', docLoc: '', notes: 'Синтетичний запис' };
    await page.evaluate(async ({ person, medical, episode }) => {
      localStorage.setItem('tactical_personnel', JSON.stringify([person]));
      await localforage.setItem('med_soldiers_v3', [medical]); await localforage.setItem('med_episodes_v3', [episode]);
    }, { person, medical, episode });
    await page.reload({ waitUntil: 'networkidle' }); await ready();
    await top('Медична Евакуація');
    const form = page.locator('#med-app form').first();
    const open = async () => {
      await page.getByRole('button', { name: 'Створити запис', exact: true }).click();
      await page.getByPlaceholder('Позивний (за наявності)...', { exact: true }).fill('Мак');
      await page.getByTestId('personnel-match').filter({ hasText: 'Журнал О/С' }).first().click();
    };
    await open();
    assert.equal(await page.getByPlaceholder('ПІБ повністю...', { exact: true }).inputValue(), person.fullName);
    assert.equal(await page.getByLabel('Звання військовослужбовця', { exact: true }).inputValue(), person.rank);
    assert.equal(await page.getByLabel('Підрозділ військовослужбовця', { exact: true }).inputValue(), person.unit);
    await form.locator(':scope > div').first().getByRole('button').click();
    assert.deepEqual(await page.evaluate(() => localforage.getItem('med_soldiers_v3')), [medical]);
    await open();
    await form.locator('input[type=datetime-local]').first().fill('2026-09-15T12:30');
    for (const value of ['Поранення (300)', 'Легкий', 'Інше']) await form.locator('select').filter({ has: page.locator('option').filter({ hasText: new RegExp('^' + value.replace(/[()]/g, '\\$&') + '$') }) }).selectOption(value);
    await form.locator('button[type=submit]').click();
    await page.waitForFunction(async () => (await localforage.getItem('med_episodes_v3')).length === 2);
    const saved = await page.evaluate(async () => ({ people: await localforage.getItem('med_soldiers_v3'), episodes: await localforage.getItem('med_episodes_v3'), roster: JSON.parse(localStorage.getItem('tactical_personnel')) }));
    assert.equal(saved.people.length, 1);
    assert.equal(saved.people[0].sourceRosterId, person.id);
    assert.deepEqual(saved.episodes.find(row => row.id === episode.id), episode, 'Original HTML leaves older unsnapshotted records unchanged');
    assert.equal(saved.episodes.find(row => row.id !== episode.id).personnelSnapshot.unit, person.unit);
    assert.deepEqual(saved.roster, [person]);
    console.log('PASS: original personnel autocomplete, cancel, reuse, record snapshot and unchanged older data');
    await top('Журнал О/С'); await page.locator('#nav-personnel').click();
    await page.locator('#app-tactical-container input[type=file]').setInputFiles({ name: 'synthetic-roster.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ personnel: [{ ...person, status: 'rest' }], journal: [] })) });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('tactical_personnel'))[0].status === 'ok');
    await top('Втрати Противника');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log('PASS: six tabs, native startup/callbacks/legacy import; local startup assets; no uncaught errors; selected HTML behavior retained');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
