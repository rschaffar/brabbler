import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const fixture = fileURLToPath(new URL("./dependency-advisory-boundary.fixture.mjs", import.meta.url));

function probe(name) {
  const result = spawnSync(process.execPath, ["--max-old-space-size=256", fixture, name], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 64 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

test("small DOCX conversion and embedded styles do not load the CLI formatter branch", () => {
  assert.deepEqual(probe("mammoth"), {
    conversions: 2,
    embeddedStyleApplied: true,
    conversionForbiddenLoads: 0,
    positiveControls: 2,
  });
});

test("Next lint root directories remain literal without explicit glob configuration", () => {
  assert.deepEqual(probe("braces"), {
    defaultGlobCalls: 0,
    stringControls: 1,
    arrayControls: 2,
    actualParserExecuted: false,
  });
});
