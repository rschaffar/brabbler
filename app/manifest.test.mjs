import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import manifest, { dynamic } from "./manifest.ts";

test("manifest reads the installed app name at runtime without changing identity or metadata", (t) => {
  const original = process.env.BRABBLER_APP_NAME;
  t.after(() => {
    if (original === undefined) delete process.env.BRABBLER_APP_NAME;
    else process.env.BRABBLER_APP_NAME = original;
  });
  assert.equal(dynamic, "force-dynamic");
  delete process.env.BRABBLER_APP_NAME;
  const defaults = manifest();
  assert.equal(defaults.name, "Brabbler");
  assert.equal(defaults.short_name, "Brabbler");
  for (const [value, expected] of [["", "Brabbler"], [" \t\n ", "Brabbler"], ["  Brabbler 🚀 \n", "Brabbler 🚀"], ["Another instance", "Another instance"]]) {
    process.env.BRABBLER_APP_NAME = value;
    assert.deepEqual(manifest(), { ...defaults, name: expected, short_name: expected });
  }
});

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function pngSize(bytes) {
  assert.equal(bytes.subarray(0, 8).equals(pngSignature), true, "valid PNG signature");
  assert.equal(bytes.toString("ascii", 12, 16), "IHDR");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test("installed mascot assets match the manifest and Apple icon dimensions", () => {
  for (const icon of manifest().icons) {
    const bytes = readFileSync(new URL(`../public${icon.src}`, import.meta.url));
    assert.equal(pngSize(bytes).join("x"), icon.sizes);
  }
  assert.deepEqual(pngSize(readFileSync(new URL("../public/icons/apple-touch-icon.png", import.meta.url))), [180, 180]);
  const svg = readFileSync(new URL("../public/brand/robot.svg", import.meta.url), "utf8");
  assert.match(svg, /<title>Brabbler robot face with a crooked antenna<\/title>/);
  assert.doesNotMatch(svg, /<(?:script|foreignObject|image|use)\b|\bon\w+\s*=|\b(?:href|src)\s*=/i);
});

test("favicon contains complete native 16, 32 and 48px PNG entries", () => {
  const ico = readFileSync(new URL("./favicon.ico", import.meta.url));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  let offset = 6 + 3 * 16;
  for (const [index, size] of [16, 32, 48].entries()) {
    const entry = 6 + index * 16;
    assert.equal(ico[entry], size);
    assert.equal(ico[entry + 1], size);
    assert.equal(ico.readUInt16LE(entry + 4), 1);
    assert.equal(ico.readUInt16LE(entry + 6), 32);
    assert.equal(ico.readUInt32LE(entry + 12), offset);
    const length = ico.readUInt32LE(entry + 8);
    assert.ok(offset + length <= ico.length);
    assert.deepEqual(pngSize(ico.subarray(offset, offset + length)), [size, size]);
    offset += length;
  }
  assert.equal(offset, ico.length);
});
