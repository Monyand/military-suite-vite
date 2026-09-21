import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const target = resolve(root, 'dist-single/MilitarySuite.html');
if (!existsSync(target)) throw new Error('Спочатку виконайте npm run build:single');
const env = { ...process.env, SUITE_TEST_URL: pathToFileURL(target).href, SUITE_TEST_OFFLINE: '1' };
for (const args of [['tests/suite-single-file.cjs'], ['scripts/test.mjs'], ['scripts/test.mjs', '--browser']]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status || 1);
}
