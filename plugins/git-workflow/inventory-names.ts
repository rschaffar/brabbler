import { createReadStream } from "node:fs";
import { mkdtemp, open, opendir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

async function* lines(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path);
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try { for await (const line of reader) yield JSON.parse(line) as string; }
  finally { reader.close(); stream.destroy(); }
}
/** Deterministic inventory order with bounded sort memory, even for a directory
 * with millions of children. Scratch lives outside the inventoried checkout. */
export async function* sortedDirectoryNames(directory: string, guard: () => void, batchSize = 4096): AsyncGenerator<string> {
  let scratch: string | undefined; let sequence = 0; let batch: string[] = []; const runs: string[] = [];
  const flush = async () => {
    scratch ??= await mkdtemp(join(tmpdir(), "brabbler-git-inventory-"));
    const path = join(scratch, String(sequence++)); const file = await open(path, "wx", 0o600);
    try { await file.writeFile(batch.sort().map((name) => JSON.stringify(name) + "\n").join("")); }
    finally { await file.close(); }
    runs.push(path); batch = [];
  };
  try {
    for await (const entry of await opendir(directory)) {
      guard(); batch.push(entry.name); if (batch.length >= batchSize) await flush();
    }
    if (!runs.length) { yield* batch.sort(); return; }
    if (batch.length) await flush();
    while (runs.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < runs.length; i += 2) {
        guard();
        if (i + 1 === runs.length) { next.push(runs[i]); continue; }
        const output = join(scratch!, String(sequence++)); const file = await open(output, "wx", 0o600);
        const a = lines(runs[i]), b = lines(runs[i + 1]);
        try {
          let left = await a.next(), right = await b.next(), buffer = "";
          while (!left.done || !right.done) {
            guard();
            if (right.done || !left.done && left.value <= right.value) { buffer += JSON.stringify(left.value) + "\n"; left = await a.next(); }
            else { buffer += JSON.stringify(right.value) + "\n"; right = await b.next(); }
            if (buffer.length >= 65536) { await file.writeFile(buffer); buffer = ""; }
          }
          if (buffer) await file.writeFile(buffer);
        } finally { await a.return(undefined); await b.return(undefined); await file.close(); }
        await rm(runs[i]); await rm(runs[i + 1]); next.push(output);
      }
      runs.splice(0, runs.length, ...next);
    }
    for await (const name of lines(runs[0])) { guard(); yield name; }
  } finally { if (scratch) await rm(scratch, { recursive: true, force: true }); }
}
