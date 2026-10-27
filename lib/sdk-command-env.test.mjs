import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, lstatSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { findPackageJSON } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";
import patcher from "../bin/patch-sdk-command-env.js";
const { payload, inspectSdkCommandEnvironment, applySdkCommandEnvironment, checkSdkRoot, checkSdkCommandEnvironment, resolveInstalledSdkRoot } = patcher;
const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installed = dirname(findPackageJSON(payload.packageName, pathToFileURL(join(applicationRoot, "package.json")).href));
const sha = value => createHash("sha256").update(value).digest("hex");

// Future test dependencies are already patched by Nix. Copy only the twelve
// affected SDK modules plus its package.json, not the SDK tree or credentials.
// Known recipe reversal reconstructs the exact original distribution bytes.
function originalBytes(recipe) {
  let bytes = readFileSync(join(installed, recipe.path));
  if (sha(bytes) === recipe.originalSha256) return bytes;
  assert.equal(sha(bytes), recipe.patchedSha256, "installed dependency must be a recognized SDK distribution");
  let text = bytes.toString("utf8");
  for (const change of [...recipe.replacements].reverse()) {
    assert.equal(text.split(change.after).length, 2);
    text = text.replace(change.after, () => change.before);
  }
  bytes = Buffer.from(text);
  assert.equal(sha(bytes), recipe.originalSha256);
  return bytes;
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "sdk-env-fixture-"));
  const sdkRoot = join(root, "node_modules", payload.packageName);
  mkdirSync(sdkRoot, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "synthetic-sdk-host", private: true }));
  writeFileSync(join(sdkRoot, "package.json"), readFileSync(join(installed, "package.json")));
  for (const recipe of payload.files) {
    const target = join(sdkRoot, recipe.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, originalBytes(recipe));
  }
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, sdkRoot };
}
function snapshot(root) {
  const rows = [];
  function walk(directory, relative = "") {
    for (const name of readdirSync(directory).sort()) {
      const file = join(directory, name), key = relative ? relative + "/" + name : name, stat = lstatSync(file);
      rows.push([key, stat.mode, stat.ino, stat.mtimeMs, stat.isFile() ? readFileSync(file).toString("hex") : null]);
      if (stat.isDirectory()) walk(file, key);
    }
  }
  walk(root); return rows;
}
function expectRefusal(fn, code) { assert.throws(fn, error => error.code === code && error.message === `SDK command environment patch refused (${code})`); }
function patchedBytes(recipe) {
  let text = originalBytes(recipe).toString("utf8");
  for (const change of recipe.replacements) text = text.replace(change.before, () => change.after);
  assert.equal(sha(text), recipe.patchedSha256); return text;
}

test("apply/check are version-pinned, complete, exact and idempotent", t => {
  const { sdkRoot } = fixture(t);
  assert.equal(payload.files.length, 12);
  for (const target of ["dist/utils/clipboard-command.js", "dist/utils/open-browser.js", "dist/modes/rpc/rpc-client.js"]) {
    assert.ok(payload.files.some(recipe => recipe.path === target), target);
  }
  assert.equal(inspectSdkCommandEnvironment(sdkRoot).patched, false);
  const original = snapshot(sdkRoot);
  expectRefusal(() => checkSdkRoot(sdkRoot), "SDK_NOT_PATCHED");
  assert.deepEqual(snapshot(sdkRoot), original, "refused check writes nothing");
  assert.equal(applySdkCommandEnvironment(sdkRoot).changed, true);
  assert.equal(checkSdkRoot(sdkRoot).patchId, payload.patchId);
  for (const recipe of payload.files) assert.equal(sha(readFileSync(join(sdkRoot, recipe.path))), recipe.patchedSha256);
  assert.equal(readFileSync(join(sdkRoot, payload.helper.path), "utf8"), payload.helper.content);
  const patched = snapshot(sdkRoot);
  checkSdkRoot(sdkRoot);
  assert.equal(applySdkCommandEnvironment(sdkRoot).changed, false);
  assert.deepEqual(snapshot(sdkRoot), patched, "check and repeated apply preserve bytes, modes, inodes and mtimes");
});

test("unknown late input rejects before writing any otherwise valid target", t => {
  const { sdkRoot } = fixture(t);
  appendFileSync(join(sdkRoot, payload.files.at(-1).path), "\nSYNTHETIC_DO_NOT_DISCLOSE\n");
  const before = snapshot(sdkRoot);
  expectRefusal(() => applySdkCommandEnvironment(sdkRoot), "SDK_FILE_UNKNOWN");
  expectRefusal(() => checkSdkRoot(sdkRoot), "SDK_FILE_UNKNOWN");
  assert.deepEqual(snapshot(sdkRoot), before);
});

test("known mixed whole-file states are repairable, but never pass read-only check", t => {
  const { sdkRoot } = fixture(t);
  writeFileSync(join(sdkRoot, payload.files[0].path), patchedBytes(payload.files[0]));
  const before = snapshot(sdkRoot);
  expectRefusal(() => checkSdkRoot(sdkRoot), "SDK_NOT_PATCHED");
  assert.deepEqual(snapshot(sdkRoot), before);
  assert.equal(applySdkCommandEnvironment(sdkRoot).changed, true);
  checkSdkRoot(sdkRoot);
});

test("the former nine-target state cannot pass the twelve-target check", t => {
  const { sdkRoot } = fixture(t);
  for (const recipe of payload.files.slice(0, 9)) writeFileSync(join(sdkRoot, recipe.path), patchedBytes(recipe));
  writeFileSync(join(sdkRoot, payload.helper.path), payload.helper.content);
  const before = snapshot(sdkRoot);
  expectRefusal(() => checkSdkRoot(sdkRoot), "SDK_NOT_PATCHED");
  assert.deepEqual(snapshot(sdkRoot), before);
  applySdkCommandEnvironment(sdkRoot); checkSdkRoot(sdkRoot);
});

test("each newly covered exported helper is fingerprinted and fails closed on unknown bytes", async t => {
  for (const recipe of payload.files.slice(9)) await t.test(recipe.path, st => {
    const { sdkRoot } = fixture(st); applySdkCommandEnvironment(sdkRoot);
    appendFileSync(join(sdkRoot, recipe.path), "\nSYNTHETIC_UNKNOWN_EXPORTED_HELPER\n");
    const before = snapshot(sdkRoot);
    expectRefusal(() => checkSdkRoot(sdkRoot), "SDK_FILE_UNKNOWN");
    expectRefusal(() => applySdkCommandEnvironment(sdkRoot), "SDK_FILE_UNKNOWN");
    assert.deepEqual(snapshot(sdkRoot), before);
  });
});

test("a partially edited module and an unknown helper each fail before writes", async t => {
  await t.test("partial module", st => {
    const { sdkRoot } = fixture(st), recipe = payload.files[0], change = recipe.replacements[0];
    writeFileSync(join(sdkRoot, recipe.path), originalBytes(recipe).toString("utf8").replace(change.before, () => change.after));
    const before = snapshot(sdkRoot);
    expectRefusal(() => applySdkCommandEnvironment(sdkRoot), "SDK_FILE_UNKNOWN");
    assert.deepEqual(snapshot(sdkRoot), before);
  });
  await t.test("unknown helper", st => {
    const { sdkRoot } = fixture(st);
    writeFileSync(join(sdkRoot, payload.helper.path), "SYNTHETIC_HELPER_CONTENT_NOT_FOR_ERRORS");
    const before = snapshot(sdkRoot);
    expectRefusal(() => applySdkCommandEnvironment(sdkRoot), "SDK_HELPER_UNKNOWN");
    assert.deepEqual(snapshot(sdkRoot), before);
  });
});

test("known helper-only and fully patched-with-missing-helper states repair safely", async t => {
  for (const state of ["helper-only", "missing-helper"]) await t.test(state, st => {
    const { sdkRoot } = fixture(st);
    if (state === "helper-only") writeFileSync(join(sdkRoot, payload.helper.path), payload.helper.content);
    else for (const recipe of payload.files) writeFileSync(join(sdkRoot, recipe.path), patchedBytes(recipe));
    const before = snapshot(sdkRoot);
    expectRefusal(() => checkSdkRoot(sdkRoot), "SDK_NOT_PATCHED");
    assert.deepEqual(snapshot(sdkRoot), before);
    applySdkCommandEnvironment(sdkRoot); checkSdkRoot(sdkRoot);
  });
});

test("unknown manifest/version and symbolic-link targets fail closed", async t => {
  for (const state of ["version", "manifest", "symlink"]) await t.test(state, st => {
    const { sdkRoot, root } = fixture(st);
    if (state === "symlink") {
      const target = join(sdkRoot, payload.files[0].path), outside = join(root, "synthetic-external.js");
      writeFileSync(outside, originalBytes(payload.files[0])); rmSync(target); symlinkSync(outside, target);
    } else {
      const file = join(sdkRoot, "package.json"), metadata = JSON.parse(readFileSync(file, "utf8"));
      if (state === "version") metadata.version = "1.3.1"; else metadata.synthetic = true;
      writeFileSync(file, JSON.stringify(metadata));
    }
    const before = snapshot(sdkRoot);
    expectRefusal(() => applySdkCommandEnvironment(sdkRoot), state === "version" ? "SDK_VERSION" : state === "manifest" ? "SDK_MANIFEST_UNKNOWN" : "SDK_FILE_TYPE");
    assert.deepEqual(snapshot(sdkRoot), before);
  });
});

test("self-contained helper preserves socket/account/session state and explicit isolation", async t => {
  const { sdkRoot } = fixture(t); applySdkCommandEnvironment(sdkRoot);
  const { sdkCommandEnvironment: clean } = await import(pathToFileURL(join(sdkRoot, payload.helper.path)).href);
  const original = { BRABBLER_PASSWORD: "synthetic-login", BRABBLER_SSH_RUNTIME: "/synthetic/private-control",
    SSH_AUTH_SOCK: "/synthetic/stable.sock", AWS_PROFILE: "synthetic-account-a", PI_SESSION_ID: "synthetic-session-a", PI_MODEL: "synthetic-model" };
  assert.deepEqual(clean(original), { SSH_AUTH_SOCK: original.SSH_AUTH_SOCK, AWS_PROFILE: original.AWS_PROFILE, PI_SESSION_ID: original.PI_SESSION_ID, PI_MODEL: original.PI_MODEL });
  assert.equal(original.BRABBLER_PASSWORD, "synthetic-login");
  assert.deepEqual(clean({}), {});
  assert.deepEqual(clean({ SSH_AUTH_SOCK: "/synthetic/explicit.sock" }), { SSH_AUTH_SOCK: "/synthetic/explicit.sock" });
  assert.deepEqual(clean({ brabbler_password: "synthetic", Brabbler_Ssh_Runtime: "synthetic", Path: "synthetic-path", SSH_AUTH_SOCK: "explicit" }, "win32"), { Path: "synthetic-path", SSH_AUTH_SOCK: "explicit" });
});

test("installed-root resolution is independent of a hostile project cwd and check never imports SDK", t => {
  const { root, sdkRoot } = fixture(t); applySdkCommandEnvironment(sdkRoot);
  // Only a tiny resolution sentinel, not copied SDK source. Any SDK import fails.
  writeFileSync(join(sdkRoot, "dist/index.js"), 'throw new Error("SDK_MUST_NOT_BE_IMPORTED_BY_GUARD");\n');
  assert.equal(resolveInstalledSdkRoot(root), sdkRoot);
  assert.equal(checkSdkCommandEnvironment(root).patchId, payload.patchId);
  const hostile = join(root, "project"); mkdirSync(hostile);
  writeFileSync(join(hostile, "package.json"), JSON.stringify({ name: "hostile-cwd", private: true }));
  const hostileSdk = join(hostile, "node_modules", payload.packageName); mkdirSync(hostileSdk, { recursive: true });
  writeFileSync(join(hostileSdk, "package.json"), JSON.stringify({ name: payload.packageName, version: "999.0.0" }));
  const defaultCheck = spawnSync(process.execPath, [fileURLToPath(new URL("../bin/patch-sdk-command-env.js", import.meta.url)), "--check"], { cwd: hostile, env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(defaultCheck.status, 0, defaultCheck.stderr); // Actual installed application root, not hostile cwd.
  const result = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(fileURLToPath(new URL("../bin/patch-sdk-command-env.js", import.meta.url)))}).checkSdkCommandEnvironment(${JSON.stringify(root)})`], {
    cwd: hostile, env: { PATH: process.env.PATH }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const before = snapshot(sdkRoot);
  const checked = spawnSync(process.execPath, [fileURLToPath(new URL("../bin/patch-sdk-command-env.js", import.meta.url)), "--check", "--sdk-root", sdkRoot], { cwd: hostile, env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr); assert.deepEqual(snapshot(sdkRoot), before);
});

test("CLI refusal is categorical, nonzero and never dumps unknown source contents", t => {
  const { sdkRoot } = fixture(t); appendFileSync(join(sdkRoot, payload.files.at(-1).path), "\nSYNTHETIC_NEVER_LOG_THIS\n");
  const before = snapshot(sdkRoot);
  const output = spawnSync(process.execPath, [fileURLToPath(new URL("../bin/patch-sdk-command-env.js", import.meta.url)), "--apply", "--sdk-root", sdkRoot], { env: { PATH: process.env.PATH }, encoding: "utf8" });
  assert.equal(output.status, 1);
  assert.equal(output.stdout, "");
  assert.equal(output.stderr.trim(), "SDK command environment patch refused (SDK_FILE_UNKNOWN)");
  assert.deepEqual(snapshot(sdkRoot), before);
});
