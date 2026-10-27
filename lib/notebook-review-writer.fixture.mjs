import fs from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { authorizeReview, appendReview } = await jiti.import('./notebook-review-store.ts');
const [index, submissionId, releasePath, sequenceText, digest] = process.argv.slice(2);
try {
  await appendReview(authorizeReview(index, new Set([path.dirname(index)])), { sequence: Number(sequenceText), digest }, submissionId, { kind: 'resume', stepId: 'toString' }, { beforeInstall() {
    fs.writeSync(1, JSON.stringify({ ready: true, submissionId }) + '\n');
    const deadline = performance.now() + 10_000, cell = new Int32Array(new SharedArrayBuffer(4));
    // Deliberate cross-process race gate, not a delay claimed as work settlement.
    // Both writers have validated the same tip and staged/fsynced bytes. Parent
    // releases only after both ready messages, then joins both actual processes.
    while (!fs.existsSync(releasePath)) {
      if (performance.now() >= deadline) throw new Error('Named installation gate was not released');
      Atomics.wait(cell, 0, 0, 5);
    }
  } });
  fs.writeSync(1, JSON.stringify({ ok: true, submissionId }) + '\n');
} catch (e) { fs.writeSync(1, JSON.stringify({ ok: false, error: e.message, submissionId }) + '\n'); }
