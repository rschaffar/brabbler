import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
// Architecture/capability-absence guard, not a file-search behavioral owner.
// The actual controls use /api/file-index in mounted tests. Native file routes
// still own physical containment and bounded index authorization independently.
test('ordinary files route has no legacy general filesystem-search capability', async () => {
  const source = await readFile(new URL('../app/api/files/[...path]/route.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /type === "search"|searchFiles/);
});
