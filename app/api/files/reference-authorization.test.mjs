import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { loadTsModule } from "../../../lib/sse-stream.fixture.mjs";

const jiti = createJiti(import.meta.url);
const { isFilePathReferencedByEntries, isValidSessionId } = await jiti.import("../../../lib/session-file-references-core.ts");
const { isPathWithinRoots, isExistingPathWithinRoots } = await jiti.import("../../../lib/path-security.ts");
const { filePathFromApiSegments } = await jiti.import("../../../lib/paths.ts");
const { readTextPreviewChunk } = await jiti.import("../../../lib/text-preview.ts");
const { getAudioMime, getVideoMime } = await jiti.import("../../../lib/file-types.ts");
const fileLanguage = await jiti.import("../../../lib/file-language.ts");
const sessionId = "550e8400-e29b-41d4-a716-446655440000";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-reference-policy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const allowed = path.join(root, "allowed"), outside = path.join(root, "outside.txt");
  fs.mkdirSync(allowed);
  fs.writeFileSync(outside, "SAFE_REFERENCE_SENTINEL\n");
  let entries = [], stats = 0;
  const roots = new Set([allowed]);
  const mocks = {
    "next/server": { NextResponse: { json: Response.json } },
    fs: { ...fs, statSync(...args) { stats++; return fs.statSync(...args); } }, path,
    "@/lib/file-access": { getAllowedFileRoots: async () => roots, isFilePathAllowed: isPathWithinRoots, isExistingFilePathAllowed: isExistingPathWithinRoots },
    "@/lib/file-types": { getImageMime: () => null, getAudioMime, getVideoMime, getDocumentMime: () => null },
    "@/lib/file-language": fileLanguage,
    "@/lib/file-dirent": {},
    "@/lib/session-file-references": { isFilePathReferencedBySession: async (file, id) => isValidSessionId(id) && id === sessionId && isFilePathReferencedByEntries(file, entries) },
    "@/lib/request-security": {}, "@/lib/file-edit": {}, "@/lib/file-upload": {}, "@/lib/bounded-form-data": {},
    "@/lib/paths": { filePathFromApiSegments }, "@/lib/text-preview": { readTextPreviewChunk },
    "@/lib/sse-stream": { createSseStream: () => assert.fail("unauthorized watch acquired a stream") },
  };
  const { GET } = loadTsModule(new URL("./[...path]/route.ts", import.meta.url), mocks).exports;
  return {
    outside, allowed, get stats() { return stats; }, set entries(value) { entries = value; },
    async request(type, id = sessionId, { file = outside, viewerCwd = allowed, range } = {}) {
      const request = new Request(`http://localhost/api/files/fixture?type=${type}&sessionId=${encodeURIComponent(id)}&viewerCwd=${encodeURIComponent(viewerCwd)}`, { headers: range ? { range } : {} });
      request.nextUrl = new URL(request.url);
      return GET(request, { params: Promise.resolve({ path: file.replace(/^\//, "").split("/") }) });
    },
  };
}

const entry = (role, content, extra = {}) => ({ type: "message", id: "entry", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role, content, ...extra } });

test("all reference-enabled routes deny untrusted transcript paths before filesystem access", async (t) => {
  const f = fixture(t);
  const text = [{ type: "text", text: f.outside }];
  for (const source of [
    entry("system", text), entry("toolResult", text, { toolName: "remote_search", toolCallId: "remote" }),
    { type: "custom", id: "receipt", customType: "pi-web:operation-receipt", data: { patch: f.outside, authorized: true } },
    { type: "context_edit", id: "edit", replacement: { content: text } },
    entry("toolResult", [], { toolName: "mcp.read", details: { fullOutputPath: f.outside } }),
  ]) {
    f.entries = [source];
    for (const type of ["read", "download", "meta", "preview", "watch"]) {
      const response = await f.request(type);
      assert.equal(response.status, 403, `${source.type}/${source.message?.role}: ${type}`);
      assert.equal(f.stats, 0, "authorization must precede stat/read/watch");
    }
  }
});

test("a different literal filename cannot authorize an existing outside-root file", async (t) => {
  const f = fixture(t);
  for (const literal of [f.outside + "#other", f.outside + "?other", f.outside + ":12", encodeURIComponent(f.outside)]) {
    f.entries = [entry("assistant", [{ type: "toolCall", id: "call", name: "read", arguments: { path: literal } }])];
    assert.equal((await f.request("read")).status, 403);
    assert.equal(f.stats, 0);
  }
});

test("intentional exact links still read external files but never authorize listing or editing", async (t) => {
  const f = fixture(t);
  f.entries = [entry("assistant", [{ type: "text", text: `See [file](${f.outside}#L1)` }])];
  const response = await f.request("read");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.content, "SAFE_REFERENCE_SENTINEL\n");
  assert.deepEqual(body.probeEligibility, { edit: false, gitDiff: false });
  for (const type of ["list", "edit"]) assert.equal((await f.request(type)).status, 403);
  for (const id of ["", "invalid", "550e8400-e29b-41d4-a716-446655440001"]) assert.equal((await f.request("read", id)).status, 403);
});

test("external media range reads retain exact session authorization and read-only policy", async t => {
  const f = fixture(t);
  for (const ext of ["wav", "webm"]) {
    const file = `${f.outside}.${ext}`;
    fs.writeFileSync(file, Buffer.from([0, 1, 255, 3, 4, 5]));
    f.entries = [entry("assistant", [{ type: "text", text: `![Media](${file})` }])];
    const response = await f.request("read", sessionId, { file, range: "bytes=1-3" });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-type"), ext === "wav" ? "audio/wav" : "video/webm");
    assert.equal(response.headers.get("content-range"), "bytes 1-3/6");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([1, 255, 3]));
    for (const id of ["", "invalid", "550e8400-e29b-41d4-a716-446655440001"]) assert.equal((await f.request("read", id, { file, range: "bytes=1-3" })).status, 403);
    for (const type of ["edit", "list"]) assert.equal((await f.request(type, sessionId, { file })).status, 403);
    f.entries = [entry("system", [{ type: "text", text: file }])];
    assert.equal((await f.request("read", sessionId, { file, range: "bytes=1-3" })).status, 403);
  }
});

test("probe hints narrow reads without authorizing edits and preserve deleted-file Git eligibility", async t => {
  const f = fixture(t);
  const file = path.join(f.allowed, "inside.txt");
  fs.writeFileSync(file, "root-authorized text");
  const allowed = await f.request("read", sessionId, { file });
  assert.equal(allowed.status, 200);
  assert.deepEqual((await allowed.json()).probeEligibility, { edit: true, gitDiff: true });
  const otherCwd = await f.request("read", sessionId, { file, viewerCwd: path.dirname(f.allowed) });
  assert.equal(otherCwd.status, 200, "viewer cwd cannot determine file-read authority");
  assert.deepEqual((await otherCwd.json()).probeEligibility, { edit: true, gitDiff: false });
  const deleted = await f.request("read", sessionId, { file: path.join(f.allowed, "deleted.txt") });
  assert.equal(deleted.status, 404);
  assert.deepEqual((await deleted.json()).probeEligibility, { edit: false, gitDiff: true });
  const subtree = await f.request("read", sessionId, { file: path.join(f.allowed, "removed", "nested", "deleted.txt") });
  assert.equal(subtree.status, 404);
  assert.deepEqual((await subtree.json()).probeEligibility, { edit: false, gitDiff: true });
  const alias = path.join(path.dirname(f.allowed), "cwd-alias");
  fs.symlinkSync(f.allowed, alias, "dir");
  const aliasedCwd = await f.request("read", sessionId, { file, viewerCwd: alias });
  assert.deepEqual((await aliasedCwd.json()).probeEligibility, { edit: true, gitDiff: false });
  assert.equal((await f.request("read")).status, 403, "cwd hint cannot authorize an unreferenced outside file");
  fs.symlinkSync(f.outside, path.join(f.allowed, "escape.txt"));
  assert.equal((await f.request("read", sessionId, { file: path.join(f.allowed, "escape.txt") })).status, 403);
});
