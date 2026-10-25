import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { loadTsModule } from "../../../lib/sse-stream.fixture.mjs";
import { fileBodyModuleFixture } from "./file-body-module.fixture.mjs";
const jiti = createJiti(import.meta.url);
const upload = await jiti.import("../../../lib/file-upload.ts");
const bounded = await jiti.import("../../../lib/bounded-form-data.ts");
const security = await jiti.import("../../../lib/path-security.ts");
const paths = await jiti.import("../../../lib/paths.ts");

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-upload-api-")));
  let fileBody;
  t.after(async () => {
    const { closed, errors } = fileBody ? await fileBody.finish() : { closed: true, errors: [] };
    if (closed) {
      try { fs.rmSync(root, { recursive: true, force: true }); }
      catch (failure) { errors.push(failure); }
    } else {
      errors.push(new Error("upload fixture retained root: native file-body closure is uncertain"));
    }
    if (errors.length) throw new AggregateError(errors, "upload file-body runtime/cleanup failures");
  });
  const allowed = path.join(root, "allowed"), nested = path.join(allowed, "nested"), outside = path.join(root, "outside");
  for (const directory of [nested, outside]) fs.mkdirSync(directory, { recursive: true });
  let trusted = true, references = 0;
  const mocks = {
    "next/server": { NextResponse: { json: Response.json } }, fs, path,
    "@/lib/file-access": { getAllowedFileRoots: async () => new Set([allowed]), isFilePathAllowed: security.isPathWithinRoots, isExistingFilePathAllowed: security.isExistingPathWithinRoots },
    "@/lib/file-language": {}, // Upload mode never asks for presentation metadata.
    "@/lib/file-types": {}, "@/lib/file-dirent": {}, "@/lib/file-edit": {},
    "@/lib/session-file-references": { isFilePathReferencedBySession: async () => { references++; return true; } },
    "@/lib/request-security": { isApiRequestAllowed: () => trusted, hasJsonContentType: request => request.headers.get("content-type")?.startsWith("application/json") },
    "@/lib/file-upload": upload, "@/lib/bounded-form-data": bounded,
    "@/lib/paths": paths, "@/lib/text-preview": {}, "@/lib/sse-stream": {},
  };
  fileBody = fileBodyModuleFixture(mocks.fs, { allowReads: false });
  mocks["@/lib/file-body-stream"] = fileBody.load();
  const { POST } = loadTsModule(new URL("./[...path]/route.ts", import.meta.url), mocks, { Buffer }).exports;
  async function request(directory, type, body, headers = {}, literalUrl) {
    // Serialize multipart before dispatch. Cancelling a live Undici FormData
    // producer on early wire-size refusal otherwise leaves its iterator active.
    const multipart = body instanceof FormData ? new Response(body) : null;
    const request = new Request(literalUrl ?? `http://localhost/api/files/fixture?type=${type}&sessionId=550e8400-e29b-41d4-a716-446655440000`, {
      method: "POST", body: multipart ? await multipart.arrayBuffer() : JSON.stringify(body),
      headers: multipart ? { "content-type": multipart.headers.get("content-type"), ...headers } : { "content-type": "application/json", ...headers },
    });
    request.nextUrl = new URL(request.url);
    return POST(request, { params: Promise.resolve({ path: directory.replace(/^\//, "").split("/") }) });
  }
  function form(entries) {
    const form = new FormData();
    for (const [name, content] of entries) form.append("files", new Blob([content]), name);
    return form;
  }
  return { root, allowed, nested, outside, request, form, set trusted(value) { trusted = value; }, get references() { return references; } };
}

test("nested upload-check and uploads retain conflict/error/skip/overwrite semantics", async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.nested, "old.txt"), "old");
  const check = await f.request(f.nested, "upload-check", { fileNames: ["old.txt", "new.txt"] });
  assert.equal(check.status, 200);
  assert.deepEqual(await check.json(), { conflicts: ["old.txt"], nonReplaceable: [] });
  const conflict = await f.request(f.nested, "upload", f.form([["old.txt", "ours"], ["new.txt", "new"]]));
  assert.equal(conflict.status, 409);
  assert.equal(fs.existsSync(path.join(f.nested, "new.txt")), false, "default conflict refuses whole batch before writes");
  const skip = await f.request(f.nested, "upload&conflict=skip", f.form([["old.txt", "ours"], ["new.txt", "new"]]));
  assert.deepEqual(await skip.json(), { uploaded: ["new.txt"], skipped: ["old.txt"], errors: [] });
  const replace = await f.request(f.nested, "upload&conflict=overwrite", f.form([["old.txt", "ours"]]));
  assert.equal(replace.status, 200);
  assert.equal(fs.readFileSync(path.join(f.nested, "old.txt"), "utf8"), "ours");
  assert.equal(fs.existsSync(path.join(f.allowed, "old.txt")), false);
});

test("untrusted, outside-root, traversal and escaping symlink uploads never consult transcript grants", async t => {
  const f = fixture(t);
  f.trusted = false;
  assert.equal((await f.request(f.nested, "upload", f.form([["x.txt", "x"]]))).status, 403);
  f.trusted = true;
  fs.symlinkSync(f.outside, path.join(f.allowed, "escape"), process.platform === "win32" ? "junction" : "dir");
  for (const directory of [f.outside, path.join(f.allowed, "escape"), f.allowed + "/../outside"]) {
    for (const type of ["upload-check", "upload"]) {
      const response = await f.request(directory, type, type === "upload" ? f.form([["x.txt", "x"]]) : { fileNames: ["x.txt"] });
      assert.equal(response.status, 403);
    }
  }
  assert.equal(f.references, 0, "reference-only reads must never participate in write admission");
  assert.deepEqual(fs.readdirSync(f.outside), []);
});

test("rejects malformed/oversized preflight and invalid destinations/names", async t => {
  const f = fixture(t);
  for (const names of [[], ["../x"], ["folder\\x"], ["same", "same"], [""], ["."], [".."], ["nul\0name"]]) {
    assert.equal((await f.request(f.nested, "upload-check", { fileNames: names })).status, 400);
  }
  assert.equal((await f.request(f.nested, "upload-check", { fileNames: [42] })).status, 400);
  assert.equal((await f.request(f.nested, "upload-check", { fileNames: ["x".repeat(1024 * 1024)] })).status, 413);
  assert.equal((await f.request(f.nested, "upload-check", { fileNames: ["x"] }, { "content-type": "text/plain" })).status, 400);
  assert.equal((await f.request(path.join(f.allowed, "missing"), "upload-check", { fileNames: ["x"] })).status, 404);
  fs.writeFileSync(path.join(f.allowed, "file"), "file");
  assert.equal((await f.request(path.join(f.allowed, "file"), "upload-check", { fileNames: ["x"] })).status, 400);
  if (process.platform !== "win32") {
    fs.chmodSync(f.nested, 0o555);
    assert.equal((await f.request(f.nested, "upload-check", { fileNames: ["x"] })).status, 403);
    fs.chmodSync(f.nested, 0o755);
  }
  assert.equal((await f.request(f.nested, "upload&conflict=unknown", f.form([["x", "x"]]))).status, 400);
});

test("same-root symlink folders are allowed but symlink/directory files cannot be overwritten", async t => {
  const f = fixture(t);
  fs.symlinkSync(f.nested, path.join(f.allowed, "alias"), process.platform === "win32" ? "junction" : "dir");
  assert.equal((await f.request(path.join(f.allowed, "alias"), "upload", f.form([["inside.txt", "inside"]]))).status, 200);
  assert.equal(fs.readFileSync(path.join(f.nested, "inside.txt"), "utf8"), "inside");
  fs.mkdirSync(path.join(f.nested, "folder"));
  fs.writeFileSync(path.join(f.outside, "sentinel"), "untouched");
  let linked = false;
  try { fs.symlinkSync(path.join(f.outside, "sentinel"), path.join(f.nested, "link")); linked = true; }
  catch (error) { if (error.code !== "EPERM") throw error; t.diagnostic("File symlink privilege unavailable; folder and successful-file assertions still run"); }
  const entries = [["folder", "bad"], ...(linked ? [["link", "bad"]] : []), ["good.txt", "good"]];
  const response = await f.request(f.nested, "upload&conflict=overwrite", f.form(entries));
  assert.equal(response.status, 207);
  const result = await response.json();
  assert.deepEqual(result.uploaded, ["good.txt"]);
  assert.deepEqual(result.errors.map(item => item.name), linked ? ["folder", "link"] : ["folder"]);
  assert.equal(fs.readFileSync(path.join(f.outside, "sentinel"), "utf8"), "untouched");
});

test("retains per-file and aggregate upload size limits, including wire-body rejection", async t => {
  const f = fixture(t);
  assert.equal((await f.request(f.nested, "upload", f.form([["large", new Uint8Array(25 * 1024 * 1024 + 1)]]))).status, 413);
  const entries = Array.from({ length: 5 }, (_, i) => [`file-${i}`, new Uint8Array(20 * 1024 * 1024 + 1)]);
  assert.equal((await f.request(f.nested, "upload", f.form(entries))).status, 413);
  assert.equal((await f.request(f.nested, "upload", f.form([["x", "x"]]), { "content-length": String(102 * 1024 * 1024) })).status, 413);
  assert.deepEqual(fs.readdirSync(f.nested), []);
});

// Original browser tuple at the EXISTING real default-route/native fixture.
test("literal outside upload siblings deny sentinel JSON and real FormData without reference authority", async t => {
  const f = fixture(t);
  for (const width of [1280, 390]) {
    const outside = path.join(f.root, `upload-outside-${width}`);
    fs.mkdirSync(outside, { recursive: true });
    const encoded = outside.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    for (const type of ["upload-check", "upload"]) {
      const form = new FormData(); form.append("files", new Blob(["forbidden"]), "sentinel.txt");
      const url = `http://localhost/api/files/${encoded}?type=${type}`;
      const response = await f.request(outside, type,
        type === "upload-check" ? { fileNames: ["sentinel.txt"] } : form, {}, url);
      await response.arrayBuffer(); // COMPLETE real response body BEFORE status.
      assert.equal(response.status, 403, "literal outside-root directories remain non-uploadable");
      assert.equal(fs.existsSync(path.join(outside, "sentinel.txt")), false, "native no-write for literal forbidden bytes");
    }
    assert.deepEqual(fs.readdirSync(outside), []);
  }
  assert.equal(f.references, 0, "literal source/request values never become write authority");
  // Existing fixture.finish joins native file-body closure BEFORE removing root;
  // a denied status or missing file is not substituted for descriptor closure.
});
