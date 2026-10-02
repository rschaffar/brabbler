import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Loaded through jiti so the module's own extensionless imports resolve the way
// the app resolves them (tsconfig moduleResolution: "bundler"); bare
// `import("./path-security.ts")` only works while that file has no imports.
async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./path-security.ts");
}

test("rejects an existing path that escapes an allowed root through a symlink", async (t) => {
  const { isExistingPathWithinRoots, isPathWithinRoots } = await loadSubject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-access-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
  const link = path.join(allowed, "link");
  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  const target = path.join(link, "secret.txt");
  const roots = new Set([allowed]);

  assert.equal(isPathWithinRoots(target, roots), true);
  assert.equal(isExistingPathWithinRoots(target, roots), false);
});

test("known-root history snapshot never scans or spawns, fails closed cold/expired, and retains explicit admission after removal", async (t) => {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { interopDefault: false });
  const fileAccess = await jiti.import("./file-access.ts");
  const reader = await jiti.import("./session-reader.ts");
  const beforeCache = globalThis.__piAllowedRootsCache, beforeAdditional = globalThis.__piAdditionalAllowedRoots;
  const forbidden = [];
  t.after(() => {
    globalThis.__piAllowedRootsCache = beforeCache;
    globalThis.__piAdditionalAllowedRoots = beforeAdditional;
    for (const spy of forbidden) spy.mock.restore();
    syncBuiltinESMExports();
  });
  for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    forbidden.push(t.mock.method(childProcess, method, () => { throw new Error("Unexpected subprocess"); }));
  }
  forbidden.push(t.mock.method(childProcess.ChildProcess.prototype, "spawn", () => { throw new Error("Unexpected native spawn"); }));
  syncBuiltinESMExports();
  forbidden.push(t.mock.method(reader, "listAllSessions", () => { throw new Error("Unexpected history scan"); }));
  globalThis.__piAllowedRootsCache = undefined;
  globalThis.__piAdditionalAllowedRoots = undefined;
  assert.deepEqual([...fileAccess.getKnownAllowedFileRoots()], []);
  assert.equal(globalThis.__piAllowedRootsCache, undefined);
  assert.equal(globalThis.__piAdditionalAllowedRoots, undefined, "snapshot has no bookkeeping writes");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-known-roots-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const admitted = path.join(base, "admitted"), unadmitted = path.join(base, "unadmitted");
  fs.mkdirSync(admitted);
  fileAccess.allowFileRoot(admitted);
  fs.rmSync(admitted, { recursive: true });
  assert.equal(fileAccess.isFilePathAllowed(admitted, fileAccess.getKnownAllowedFileRoots()), true);
  assert.equal(fileAccess.isFilePathAllowed(unadmitted, fileAccess.getKnownAllowedFileRoots()), false);
  const roots = fileAccess.getKnownAllowedFileRoots();
  roots.add(unadmitted); roots.delete(admitted);
  assert.equal(fileAccess.isFilePathAllowed(unadmitted, fileAccess.getKnownAllowedFileRoots()), false, "caller cannot mutate admission via snapshot");
  assert.equal(fileAccess.isFilePathAllowed(admitted, fileAccess.getKnownAllowedFileRoots()), true);
  globalThis.__piAllowedRootsCache = { roots: new Set([unadmitted]), expiresAt: Date.now() - 1 };
  assert.equal(fileAccess.isFilePathAllowed(unadmitted, fileAccess.getKnownAllowedFileRoots()), false);
  globalThis.__piAllowedRootsCache.expiresAt = Date.now() + 60_000;
  assert.equal(fileAccess.isFilePathAllowed(unadmitted, fileAccess.getKnownAllowedFileRoots()), true);
  globalThis.__piAllowedRootsCache.expiresAt = Date.now();
  assert.equal(fileAccess.isFilePathAllowed(unadmitted, fileAccess.getKnownAllowedFileRoots()), false);
  for (const spy of forbidden) assert.equal(spy.mock.callCount(), 0);
});
