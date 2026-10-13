import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = await readFile(new URL("./[...path]/route.ts", import.meta.url), "utf8");
const start = source.indexOf("function streamFile");
const end = source.indexOf("function escapeHtml", start);
assert.notEqual(start, -1, "streamFile not found");
assert.notEqual(end, -1, "streamFile end not found");
const streamBlock = source.slice(start, end);

test("file body streams preserve binary chunks and encode string chunks as UTF-8", async () => {
  const helperStart = source.indexOf("function createFileBodyStream");
  const helperEnd = source.indexOf("function encodeHeaderValue", helperStart);
  assert.ok(helperStart !== -1 && helperEnd > helperStart);
  const helper = stripTypeScriptTypes(source.slice(helperStart, helperEnd));
  const fileStream = new EventEmitter();
  let destroyed = false;
  fileStream.destroy = () => { destroyed = true; };
  // Compile only the repository-owned helper, with a fake filesystem stream.
  const createStream = new Function("fs", `${helper}; return createFileBodyStream;`)({
    createReadStream: () => fileStream,
  });
  const body = createStream("fixture.bin");
  fileStream.emit("data", Buffer.from([0, 255, 128]));
  fileStream.emit("data", "Grüße");
  fileStream.emit("end");
  const bytes = Buffer.from(await new Response(body).arrayBuffer());
  assert.deepEqual(bytes, Buffer.concat([Buffer.from([0, 255, 128]), Buffer.from("Grüße")]));
  assert.equal(destroyed, false);
});

test("streamed responses are not content-type sniffable", () => {
  assert.match(streamBlock, /"X-Content-Type-Options": "nosniff"/);
});

test("inline SVG is served with a script-blocking content security policy", () => {
  // SVG is the only inline preview type a browser executes as a document, so
  // it must never be able to run script in the Pi Web origin.
  assert.match(streamBlock, /contentType === "image\/svg\+xml"/);
  assert.match(streamBlock, /Content-Security-Policy/);
  assert.match(streamBlock, /default-src 'none'/);
  assert.match(streamBlock, /style-src 'unsafe-inline'/);
  assert.match(streamBlock, /frame-ancestors 'self'/);
});

test("the restrictive headers are applied to every streamFile response shape", () => {
  // The header object is shared by the full-body, 416, and 206 paths.
  const headerObject = streamBlock.indexOf("const headers");
  const firstReturn = streamBlock.indexOf("createFileBodyStream", headerObject);
  assert.ok(headerObject !== -1 && firstReturn > headerObject, "headers must be built before any response");
});
