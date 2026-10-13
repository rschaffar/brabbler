// Metadata-only check for the two independent locks; no installed modules needed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
for (const directory of ["", "demo/"]) {
  const manifest = JSON.parse(readFileSync(new URL(`${directory}package.json`, root), "utf8"));
  const lock = JSON.parse(readFileSync(new URL(`${directory}package-lock.json`, root), "utf8"));
  const label = directory || "root/";
  const version = manifest.dependencies.katex;
  assert.equal(version, "0.19.0", `${label}: exact reviewed security-fixed pin`);
  assert.equal(manifest.overrides.katex, "$katex", `${label}: shared renderer override`);
  assert.equal(lock.packages[""].dependencies.katex, version, `${label}: manifest/lock identity`);
  const copies = Object.entries(lock.packages).filter(([path]) => /(?:^|\/)node_modules\/katex$/.test(path));
  assert.ok(copies.length > 0, `${label}: renderer must be present`);
  for (const [path, entry] of copies) assert.equal(entry.version, version, `${label}${path}: renderer/CSS alignment`);
  console.log(`PASS: ${label} ${copies.length} KaTeX copy/copies at ${version}`);
}
