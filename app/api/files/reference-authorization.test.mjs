import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { loadTsModule } from "../../../lib/sse-stream.fixture.mjs";

const jiti = createJiti(import.meta.url);
const { isFilePathReferencedByEntries, isValidSessionId } = await jiti.import("../../../lib/session-file-references-core.ts");
const { isPathWithinRoots } = await jiti.import("../../../lib/path-security.ts");
const { filePathFromApiSegments } = await jiti.import("../../../lib/paths.ts");
const { readTextPreviewChunk } = await jiti.import("../../../lib/text-preview.ts");
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
    "@/lib/file-access": { getAllowedFileRoots: async () => roots, isFilePathAllowed: isPathWithinRoots, isExistingFilePathAllowed: () => false },
    "@/lib/file-types": { getImageMime: () => null, getAudioMime: () => null, getVideoMime: () => null, getDocumentMime: () => null },
    "@/lib/file-dirent": {},
    "@/lib/session-file-references": { isFilePathReferencedBySession: async (file, id) => isValidSessionId(id) && id === sessionId && isFilePathReferencedByEntries(file, entries) },
    "@/lib/request-security": {}, "@/lib/file-edit": {}, "@/lib/file-upload": {}, "@/lib/bounded-form-data": {},
    "@/lib/paths": { filePathFromApiSegments }, "@/lib/text-preview": { readTextPreviewChunk },
    "@/lib/sse-stream": { createSseStream: () => assert.fail("unauthorized watch acquired a stream") },
  };
  const { GET } = loadTsModule(new URL("./[...path]/route.ts", import.meta.url), mocks).exports;
  return {
    outside, get stats() { return stats; }, set entries(value) { entries = value; },
    async request(type, id = sessionId) {
      const request = new Request(`http://localhost/api/files/fixture?type=${type}&sessionId=${encodeURIComponent(id)}`);
      request.nextUrl = new URL(request.url);
      return GET(request, { params: Promise.resolve({ path: outside.replace(/^\//, "").split("/") }) });
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
  assert.equal((await response.json()).content, "SAFE_REFERENCE_SENTINEL\n");
  for (const type of ["list", "edit"]) assert.equal((await f.request(type)).status, 403);
  for (const id of ["", "invalid", "550e8400-e29b-41d4-a716-446655440001"]) assert.equal((await f.request("read", id)).status, 403);
});
