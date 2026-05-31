import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const collectorFacade = new URL('../src/snapshot/collectors/runs.ts', import.meta.url);

test('runs collector public module stays a thin facade over focused modules', async () => {
  const source = await readFile(collectorFacade, 'utf8');

  assert.match(source, /export \* from '\.\/runs\/index\.js';/);
  assert.ok(
    source.split('\n').length <= 5,
    'backend/src/snapshot/collectors/runs.ts must stay a facade; put implementation in collectors/runs/*.ts',
  );
});
