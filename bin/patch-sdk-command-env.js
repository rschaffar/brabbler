"use strict";
/* Install-time, exact-byte downstream patch. Startup calls --check/the checker
 * only. No SDK imports, process.env mutations, child_process hooks or network.
 * A caller applying this patch must own an exclusive dependency installation.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { findPackageJSON } = require("node:module");
const { pathToFileURL } = require("node:url");
const payload = require("./sdk-command-env-payload");

const applicationRoot = path.resolve(__dirname, "..");
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const EXPECTED_TARGET_COUNT = 12;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function refusal(code) {
  // Never expose an fs error, source content, environment value or supplied path.
  return Object.assign(new Error(`SDK command environment patch refused (${code})`), { code });
}
function knownPath(relative) {
  if (typeof relative !== "string" || !/^dist\/[a-z0-9_./-]+\.js$/.test(relative)
    || relative.split("/").some(part => part === "." || part === ".." || !part)) throw refusal("SDK_PATCH_DATA");
  return relative;
}
function readRegular(root, relative, optional = false) {
  const parts = relative.split("/");
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (optional && i === parts.length - 1 && error.code === "ENOENT") return undefined;
      throw refusal("SDK_FILE_UNAVAILABLE");
    }
    if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw refusal("SDK_FILE_TYPE");
  }
  let descriptor;
  try {
    descriptor = fs.openSync(current, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw refusal("SDK_FILE_TYPE");
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length > MAX_FILE_BYTES) throw refusal("SDK_FILE_TYPE");
    return { bytes, sha256: digest(bytes), mode: stat.mode & 0o777, path: current };
  } catch (error) {
    if (error.code?.startsWith("SDK_")) throw error;
    throw refusal("SDK_FILE_UNAVAILABLE");
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}
function materialize(original, recipe) {
  let text = original.toString("utf8");
  for (const change of recipe.replacements) {
    if (!change.before || text.indexOf(change.before) < 0
      || text.indexOf(change.before) !== text.lastIndexOf(change.before)) throw refusal("SDK_PATCH_DATA");
    text = text.replace(change.before, () => change.after);
  }
  const bytes = Buffer.from(text, "utf8");
  if (digest(bytes) !== recipe.patchedSha256) throw refusal("SDK_PATCH_DATA");
  return bytes;
}
function inspectSdkCommandEnvironment(sdkRoot) {
  let root;
  try { root = fs.realpathSync(sdkRoot); } catch { throw refusal("SDK_ROOT_UNAVAILABLE"); }
  const manifest = readRegular(root, "package.json");
  let metadata;
  try { metadata = JSON.parse(manifest.bytes.toString("utf8")); } catch { throw refusal("SDK_VERSION"); }
  if (metadata.name !== payload.packageName || metadata.version !== payload.packageVersion) throw refusal("SDK_VERSION");
  if (manifest.sha256 !== payload.packageJsonSha256) throw refusal("SDK_MANIFEST_UNKNOWN");
  if (payload.schemaVersion !== 1 || payload.files.length !== EXPECTED_TARGET_COUNT
    || payload.patchId !== "brabbler-sdk-command-env-1.4.0-v2"
    || digest(payload.helper.content) !== payload.helper.sha256) throw refusal("SDK_PATCH_DATA");
  const paths = new Set();
  const files = payload.files.map(recipe => {
    const relative = knownPath(recipe.path);
    if (paths.has(relative)) throw refusal("SDK_PATCH_DATA");
    paths.add(relative);
    const current = readRegular(root, relative);
    const state = current.sha256 === recipe.patchedSha256 ? "patched"
      : current.sha256 === recipe.originalSha256 ? "original" : "unknown";
    if (state === "unknown") throw refusal("SDK_FILE_UNKNOWN");
    return { relative, ...current, state, replacement: state === "original" ? materialize(current.bytes, recipe) : undefined };
  });
  const helperPath = knownPath(payload.helper.path);
  if (paths.has(helperPath)) throw refusal("SDK_PATCH_DATA");
  const helper = readRegular(root, helperPath, true);
  if (helper && (helper.sha256 !== payload.helper.sha256 || !helper.bytes.equals(Buffer.from(payload.helper.content)))) throw refusal("SDK_HELPER_UNKNOWN");
  return { root, manifest, files, helper, patched: !!helper && files.every(file => file.state === "patched") };
}
function resolveInstalledSdkRoot(packageRoot = applicationRoot) {
  try {
    // Node 24's metadata resolver uses the installed application as its base,
    // never process.cwd(). It does not import/initialize the SDK entry point.
    const manifest = findPackageJSON(payload.packageName, pathToFileURL(path.join(packageRoot, "package.json")).href);
    if (!manifest) throw refusal("SDK_NOT_INSTALLED");
    return path.dirname(manifest);
  } catch { throw refusal("SDK_NOT_INSTALLED"); }
}
function checkSdkCommandEnvironment(packageRoot = applicationRoot) {
  return checkSdkRoot(resolveInstalledSdkRoot(packageRoot));
}
function checkSdkRoot(root) {
  const inspected = inspectSdkCommandEnvironment(root);
  if (!inspected.patched) throw refusal("SDK_NOT_PATCHED");
  return { patchId: payload.patchId, packageVersion: payload.packageVersion };
}
function applySdkCommandEnvironment(sdkRoot = resolveInstalledSdkRoot()) {
  // All twelve modules AND manifest/helper are preflighted before ANY writes.
  const initial = inspectSdkCommandEnvironment(sdkRoot);
  if (initial.patched) return { changed: false, patchId: payload.patchId };
  const writes = [];
  if (!initial.helper) writes.push({ relative: payload.helper.path, path: path.join(initial.root, payload.helper.path),
    replacement: Buffer.from(payload.helper.content), mode: 0o644 });
  writes.push(...initial.files.filter(file => file.state === "original"));
  const staged = [];
  try {
    for (const file of writes) {
      const temporary = path.join(path.dirname(file.path), `.brabbler-sdk-env-${randomUUID()}.tmp`);
      let descriptor;
      try {
        descriptor = fs.openSync(temporary, "wx", 0o600);
        staged.push({ ...file, temporary });
        fs.writeFileSync(descriptor, file.replacement);
        fs.fchmodSync(descriptor, file.mode);
        fs.fsyncSync(descriptor);
      } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
    }
    // Detect changed inputs before committing any target. Multi-file install is
    // not transactional: a crash during rename leaves a known repairable mixture.
    const current = inspectSdkCommandEnvironment(initial.root);
    if (current.manifest.sha256 !== initial.manifest.sha256 || !!current.helper !== !!initial.helper
      || current.files.some((file, index) => file.sha256 !== initial.files[index].sha256)) throw refusal("SDK_INSTALL_CHANGED");
    // Publish the helper first so no patched leaf can import a missing helper.
    for (const file of staged) fs.renameSync(file.temporary, file.path);
    checkSdkRoot(initial.root);
    return { changed: true, patchId: payload.patchId };
  } catch (error) {
    if (error.code?.startsWith("SDK_")) throw error;
    throw refusal("SDK_INSTALL_FAILED");
  } finally {
    for (const file of staged) {
      try { fs.unlinkSync(file.temporary); } catch { /* Renamed already, or retain a failed owned stage for inspection. */ }
    }
  }
}
function main(argv) {
  if (!(argv.length === 1 || argv.length === 3) || !["--apply", "--check"].includes(argv[0])
    || (argv.length === 3 && (argv[1] !== "--sdk-root" || !path.isAbsolute(argv[2])))) throw refusal("SDK_ARGUMENTS");
  const root = argv.length === 3 ? argv[2] : resolveInstalledSdkRoot();
  if (argv[0] === "--apply") applySdkCommandEnvironment(root); else checkSdkRoot(root);
}
module.exports = { payload, inspectSdkCommandEnvironment, resolveInstalledSdkRoot, checkSdkCommandEnvironment, checkSdkRoot, applySdkCommandEnvironment };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    const safe = error.code?.startsWith("SDK_") ? error : refusal("SDK_UNAVAILABLE");
    console.error(safe.message);
    process.exitCode = 1;
  }
}
