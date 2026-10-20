import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";
import { loadTsModule } from "../../../lib/sse-stream.fixture.mjs";
const jiti = createJiti(import.meta.url);
const fuzzy = await jiti.import("../../../lib/file-fuzzy.ts");
const security = await jiti.import("../../../lib/path-security.ts");

test("explicit search refresh replaces a cached listing only after normal authorization", async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-index-refresh-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "match-first.txt"), "first");
  let roots = new Set([root]);
  const { GET } = loadTsModule(new URL("./route.ts", import.meta.url), {
    "next/server": { NextResponse: { json: Response.json } },
    child_process: { execFile: (...args) => args.at(-1)(new Error("not a Git fixture")) }, util: { promisify }, fs, path,
    "@/lib/file-access": { getAllowedFileRoots: async () => roots, isFilePathAllowed: security.isPathWithinRoots,
      isExistingFilePathAllowed: security.isExistingPathWithinRoots, isWindowsAbsolutePath: () => false },
    "@/lib/file-fuzzy": fuzzy,
  }, { process: { env: {} } }).exports;
  async function read(refresh = false) {
    const req = { nextUrl: new URL(`http://localhost/api/file-index?cwd=${encodeURIComponent(root)}&q=match${refresh ? "&refresh=1" : ""}`) };
    return GET(req);
  }
  assert.deepEqual((await (await read()).json()).matches.filter(item => !item.isDir).map(item => item.path), ["match-first.txt"]);
  fs.writeFileSync(path.join(root, "match-second.txt"), "second");
  assert.equal((await (await read()).json()).matches.filter(item => !item.isDir).length, 1);
  assert.equal((await (await read(true)).json()).matches.filter(item => !item.isDir).length, 2);
  roots = new Set();
  assert.equal((await read(true)).status, 403, "refresh must never bypass authorization through an existing cache");
});
