import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
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

test("single-range responses preserve exact bytes, headers and cancellation ownership", async () => {
  const streams = [];
  const helper = stripTypeScriptTypes(source.slice(source.indexOf("function createFileBodyStream"), end));
  const streamFile = new Function("fs", "path", `${helper}; return streamFile;`)({
    createReadStream(file, range) {
      const stream = new EventEmitter();
      stream.destroyed = false;
      stream.destroy = () => { stream.destroyed = true; };
      streams.push(stream);
      queueMicrotask(() => {
        if (stream.destroyed) return;
        stream.emit("data", Buffer.from([0, 1, 2, 255, 4, 5]).subarray(range?.start ?? 0, (range?.end ?? 5) + 1));
        stream.emit("end");
      });
      return stream;
    },
  }, path);
  for (const [range, status, expected, contentRange] of [
    [null, 200, [0, 1, 2, 255, 4, 5], null],
    ["bytes=1-3", 206, [1, 2, 255], "bytes 1-3/6"],
    ["bytes=3-", 206, [255, 4, 5], "bytes 3-5/6"],
    ["bytes=-2", 206, [4, 5], "bytes 4-5/6"],
    ["bytes=4-999", 206, [4, 5], "bytes 4-5/6"],
  ]) {
    const response = streamFile("take.wav", { size: 6 }, "audio/wav", range);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("content-range"), contentRange);
    assert.equal(response.headers.get("content-length"), String(expected.length));
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], expected);
  }
  for (const range of ["bytes=9-", "bytes=4-2", "bytes=0-1,3-4", "items=0-1", "bytes=-0"]) {
    const before = streams.length;
    const response = streamFile("take.wav", { size: 6 }, "audio/wav", range);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */6");
    assert.equal(streams.length, before, "invalid ranges never acquire a file stream");
  }
  const response = streamFile("take.wav", { size: 6 }, "audio/wav", "bytes=0-");
  const stream = streams.at(-1);
  await response.body.cancel();
  assert.equal(stream.destroyed, true);
  stream.emit("data", Buffer.from([1]));
  stream.emit("error", new Error("late cancelled stream"));
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
