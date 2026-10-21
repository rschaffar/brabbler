import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { digest, excludedInput, inputPath } from "./config";
import type { AcceptanceSnapshot } from "./types";

interface Entry { path: string; mode: number; sha256?: string; bytes: number; identity: string }
const fingerprint = (s: { dev: number; ino: number; mode: number; size: number; mtimeMs: number; ctimeMs: number }) => JSON.stringify([s.dev, s.ino, s.mode, s.size, s.mtimeMs, s.ctimeMs]);
/** Linux descriptor-relative traversal: no source symlinks or cross-device entries are followed. */
export async function captureSnapshot(cwd: string, inputs: string[], directory: string, signal?: AbortSignal): Promise<AcceptanceSnapshot> {
  if (process.platform !== "linux") throw new Error("Managed acceptance currently requires Linux");
  if (!inputs.length || !inputs.every(inputPath)) throw new Error("Invalid snapshot input roots");
  const root = await fs.open(cwd, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const rootStat = await root.stat();
  let total = 0, entries = 0;
  const scan = async (copy: boolean): Promise<Entry[]> => {
    const rows: Entry[] = [];
    total = 0; entries = 0;
    const visit = async (parent: number, name: string, relative: string) => {
      signal?.throwIfAborted();
      if (++entries > 25000 || relative.length > 4096 || relative.split("/").length > 64) throw new Error("Snapshot inventory limit exceeded");
      const source = `/proc/self/fd/${parent}/${name}`;
      const before = await fs.lstat(source);
      if (before.dev !== rootStat.dev || before.isSymbolicLink() || (!before.isDirectory() && !before.isFile()) || before.mode & 0o6000) throw new Error(`Unsafe snapshot input: ${relative}`);
      const handle = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (before.isDirectory() ? constants.O_DIRECTORY : 0));
      try {
        if (fingerprint(await handle.stat()) !== fingerprint(before)) throw new Error(`Snapshot input changed: ${relative}`);
        if (before.isDirectory()) {
          rows.push({ path: relative, mode: 0o555, bytes: 0, identity: fingerprint(before) });
          if (copy) await fs.mkdir(path.join(directory, relative), { recursive: true, mode: 0o700 });
          const names = (await fs.readdir(`/proc/self/fd/${handle.fd}`)).sort();
          for (const child of names) {
            if (++entries > 25000) throw new Error("Snapshot inventory limit exceeded");
            if (excludedInput(child)) continue;
            if (/[\\\x00-\x1f]/.test(child)) throw new Error("Unsafe snapshot filename");
            await visit(handle.fd, child, relative + "/" + child);
          }
          if (copy) await fs.chmod(path.join(directory, relative), 0o555);
        } else {
          if (before.size > 64 * 1024 * 1024 || (total += before.size) > 512 * 1024 * 1024) throw new Error("Snapshot byte limit exceeded");
          const bytes = await handle.readFile();
          if (bytes.length !== before.size) throw new Error(`Snapshot input changed: ${relative}`);
          const mode = 0o444 | (before.mode & 0o111);
          rows.push({ path: relative, mode, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), identity: fingerprint(before) });
          if (copy) {
            await fs.mkdir(path.dirname(path.join(directory, relative)), { recursive: true, mode: 0o700 });
            await fs.writeFile(path.join(directory, relative), bytes, { flag: "wx", mode: 0o600, flush: true });
            await fs.chmod(path.join(directory, relative), mode);
          }
        }
        if (fingerprint(await handle.stat()) !== fingerprint(before) || fingerprint(await fs.lstat(source)) !== fingerprint(before)) throw new Error(`Snapshot input changed: ${relative}`);
      } finally { await handle.close(); }
    };
    for (const input of [...inputs].sort()) {
      const parts = input.split("/");
      let parent = root, intermediate;
      try {
        for (const part of parts.slice(0, -1)) {
          const next = await fs.open(`/proc/self/fd/${parent.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          if (intermediate) await intermediate.close();
          intermediate = next; parent = next;
        }
        await visit(parent.fd, parts.at(-1)!, input);
      } finally { await intermediate?.close(); }
    }
    return rows.sort((a, b) => a.path.localeCompare(b.path));
  };
  try {
    await fs.mkdir(directory, { mode: 0o700 });
    const rows = await scan(true), verified = await scan(false);
    if (JSON.stringify(rows) !== JSON.stringify(verified) || fingerprint(await root.stat()) !== fingerprint(rootStat)) throw new Error("Source changed during capture; pause source writers and request a new run");
    for (const input of inputs) {
      const parts = input.split("/");
      for (let i = parts.length - 1; i > 0; i--) await fs.chmod(path.join(directory, ...parts.slice(0, i)), 0o555);
    }
    await fs.chmod(directory, 0o555);
    const manifest = rows.map(({ identity: _identity, ...row }) => { void _identity; return row; });
    const result = { digest: digest(manifest), files: rows.filter((row) => row.sha256).length, bytes: total, directory };
    await fs.writeFile(directory + ".manifest.json", JSON.stringify({ version: 1, ...result, entries: manifest }), { flag: "wx", mode: 0o600, flush: true });
    return result;
  } finally { await root.close(); }
}

/** Revalidate the frozen copy immediately before dispatch; read-only modes are not an OS sandbox. */
export async function verifySnapshot(snapshot: AcceptanceSnapshot): Promise<void> {
  const root = await fs.lstat(snapshot.directory);
  if (!root.isDirectory() || root.isSymbolicLink() || (root.mode & 0o777) !== 0o555) throw new Error("Frozen snapshot root changed");
  const manifest = JSON.parse(await fs.readFile(snapshot.directory + ".manifest.json", "utf8"));
  if (manifest.digest !== snapshot.digest || digest(manifest.entries) !== snapshot.digest) throw new Error("Snapshot manifest changed");
  const observed: string[] = [];
  async function walk(directory: string, prefix = "") {
    for (const name of (await fs.readdir(directory)).sort()) {
      const relative = prefix ? prefix + "/" + name : name;
      const stat = await fs.lstat(path.join(directory, name));
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.isDirectory() && (stat.mode & 0o777) !== 0o555)) throw new Error("Unsafe frozen snapshot entry");
      observed.push(relative);
      if (stat.isDirectory()) await walk(path.join(directory, name), relative);
    }
  }
  await walk(snapshot.directory);
  // Intermediate directories for nested input roots are structural, not additional source inputs.
  const expected = new Set<string>();
  for (const row of manifest.entries) {
    const parts = row.path.split("/");
    for (let i = 1; i <= parts.length; i++) expected.add(parts.slice(0, i).join("/"));
    const file = path.join(snapshot.directory, row.path), stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || (stat.mode & 0o777) !== row.mode) throw new Error("Frozen snapshot mode changed");
    if (!row.sha256 && !stat.isDirectory()) throw new Error("Frozen snapshot directory changed");
    if (row.sha256 && (!stat.isFile() || createHash("sha256").update(await fs.readFile(file)).digest("hex") !== row.sha256)) throw new Error("Frozen snapshot content changed");
  }
  if (JSON.stringify(observed.sort()) !== JSON.stringify([...expected].sort())) throw new Error("Frozen snapshot inventory changed");
}
