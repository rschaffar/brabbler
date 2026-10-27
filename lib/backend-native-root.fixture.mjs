// N-only root ownership, not a capability to bypass client/native guards.
// Existing runner supplies private TMPDIR/HOME/agent before static SDK imports.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function ownedBackendNativeRoot(t) {
  let root, provisioning, proveClosed;
  // Register before provisioning, and before any caller's native admission.
  t.after(async () => {
    try { root = await provisioning; } catch { return; } // Original setup rejection remains the test failure.
    if (!root) return; // No returned root was admitted.
    if (!proveClosed) throw new Error(`Native ownership unproved; retained ${root}`);
    try { await proveClosed(); }
    catch (error) { throw new AggregateError([error], `Native ownership uncertain; retained ${root}`); }
    await rm(root, { recursive: true, force: true });
  });
  provisioning = mkdtemp(join(tmpdir(), 'brabbler-backend-native-'));
  root = await provisioning;
  return {
    root,
    closeWith(proof) {
      assert.equal(proveClosed, undefined, 'native owner has one complete domain collector');
      assert.equal(typeof proof, 'function');
      proveClosed = proof;
    },
  };
}
