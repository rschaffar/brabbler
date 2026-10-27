import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { randomUUID } from "node:crypto";
import { loadTsModule } from "./sse-stream.fixture.mjs";

const jiti = createJiti(import.meta.url);
async function loadSubject() {
  return jiti.import("./file-upload.ts");
}

test("validates upload names without accepting paths or duplicates", async () => {
  const { validateUploadFileNames } = await loadSubject();

  assert.equal(validateUploadFileNames(["one.txt", "two file.md"]), null);
  assert.match(validateUploadFileNames(["../secret.txt"]), /must not contain a path/);
  assert.match(validateUploadFileNames(["folder\\secret.txt"]), /must not contain a path/);
  assert.match(validateUploadFileNames(["same.txt", "same.txt"]), /Duplicate/);
  assert.match(validateUploadFileNames([]), /No files/);
});

test("finds conflicts and prevents replacing directories", async (t) => {
  const { inspectUploadTargets } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brabbler-upload-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, "file.txt"), "old");
  fs.mkdirSync(path.join(root, "directory"));

  assert.deepEqual(
    inspectUploadTargets(root, ["new.txt", "file.txt", "directory"]),
    {
      conflicts: ["file.txt", "directory"],
      nonReplaceable: ["directory"],
    },
  );
});

test("prevents replacing symbolic links", async (t) => {
  const { inspectUploadTargets } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brabbler-upload-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(root, "file.txt"), "old");
  try {
    fs.symlinkSync("file.txt", path.join(root, "link.txt"));
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Creating symbolic links requires additional privileges on this platform");
      return;
    }
    throw error;
  }

  assert.deepEqual(
    inspectUploadTargets(root, ["link.txt"]),
    {
      conflicts: ["link.txt"],
      nonReplaceable: ["link.txt"],
    },
  );
});

function writableFixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "brabbler-upload-write-")));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, roots: new Set([directory]), identity: fs.statSync(directory) };
}

for (const failure of ["stage", "install"]) test(`failed ${failure} preserves the original file and removes staging`, async t => {
  const { writeUploadFile } = await loadSubject();
  const target = writableFixture(t), destination = path.join(target.directory, "old.txt");
  fs.writeFileSync(destination, "original");
  const method = failure === "stage" ? "writeFileSync" : "renameSync";
  const original = fs[method];
  t.after(() => { fs[method] = original; });
  fs[method] = (...args) => {
    if (failure === "stage") original(args[0], "partial");
    throw new Error("injected storage failure");
  };
  assert.throws(() => writeUploadFile(target, "old.txt", Buffer.from("replacement"), "overwrite"), /injected/);
  fs[method] = original;
  assert.equal(fs.readFileSync(destination, "utf8"), "original");
  assert.deepEqual(fs.readdirSync(target.directory), ["old.txt"]);
});

test("staged replacement preserves mode, not inode or hardlink identity", async t => {
  const { writeUploadFile } = await loadSubject();
  const target = writableFixture(t), destination = path.join(target.directory, "old.txt");
  fs.writeFileSync(destination, "original", { mode: 0o640 });
  fs.chmodSync(destination, 0o640); // private test umask must not define the expected file mode
  let linked = false;
  try { fs.linkSync(destination, path.join(target.directory, "other-link.txt")); linked = true; }
  catch (error) {
    if (!["ENOTSUP", "EOPNOTSUPP", "EPERM", "ENOSYS"].includes(error.code)) throw error;
    t.diagnostic("Hardlink identity assertion unavailable on this filesystem; content/conflict assertions still run");
  }
  assert.equal(writeUploadFile(target, "old.txt", Buffer.from("new"), "overwrite"), "uploaded");
  assert.equal(fs.readFileSync(destination, "utf8"), "new");
  if (linked) assert.equal(fs.readFileSync(path.join(target.directory, "other-link.txt"), "utf8"), "original");
  if (process.platform !== "win32") assert.equal(fs.statSync(destination).mode & 0o777, 0o640);
  assert.equal(writeUploadFile(target, "old.txt", Buffer.from("skip"), "skip"), "skipped");
  assert.throws(() => writeUploadFile(target, "old.txt", Buffer.from("error"), "error"), /already exists/);
});

test("rejects read-only, symlink, directory and outside-root destinations", async t => {
  const { writeUploadFile, assertUploadDirectoryWritable } = await loadSubject();
  const target = writableFixture(t);
  fs.mkdirSync(path.join(target.directory, "folder"));
  let linked = false;
  try { fs.symlinkSync("missing", path.join(target.directory, "link")); linked = true; }
  catch (error) { if (error.code !== "EPERM") throw error; t.diagnostic("File symlink privilege unavailable; directory/permission assertions still run"); }
  for (const name of linked ? ["folder", "link"] : ["folder"]) {
    assert.throws(() => writeUploadFile(target, name, Buffer.from("x"), "overwrite"), /directory or symbolic link/);
  }
  fs.writeFileSync(path.join(target.directory, "readonly"), "old", { mode: 0o444 });
  assert.throws(() => writeUploadFile(target, "readonly", Buffer.from("x"), "overwrite"), /not writable/);
  assert.throws(() => assertUploadDirectoryWritable({ ...target, roots: new Set() }), /Access denied/);
  if (process.platform !== "win32") {
    fs.chmodSync(target.directory, 0o555);
    assert.throws(() => assertUploadDirectoryWritable(target), /not writable/);
    fs.chmodSync(target.directory, 0o755);
  }
});

test("rejects changed directory identity and changed targets after staging", async t => {
  const { writeUploadFile } = await loadSubject();
  const target = writableFixture(t), destination = path.join(target.directory, "old.txt");
  fs.writeFileSync(destination, "original");
  const original = fs.writeFileSync;
  t.after(() => { fs.writeFileSync = original; });
  fs.writeFileSync = (...args) => {
    original(...args);
    original(destination, "external change");
  };
  assert.throws(() => writeUploadFile(target, "old.txt", Buffer.from("ours"), "overwrite"), /File changed/);
  fs.writeFileSync = original;
  assert.equal(fs.readFileSync(destination, "utf8"), "external change");
  const moved = target.directory + "-moved";
  fs.renameSync(target.directory, moved);
  t.after(() => fs.rmSync(moved, { recursive: true, force: true }));
  fs.mkdirSync(target.directory);
  assert.throws(() => writeUploadFile(target, "new.txt", Buffer.from("x"), "error"), /directory changed/);
  assert.deepEqual(fs.readdirSync(target.directory), []);
});

test("new-name installation never overwrites a file created after staging", async t => {
  const { writeUploadFile } = await loadSubject();
  const target = writableFixture(t), destination = path.join(target.directory, "new.txt");
  const original = fs.linkSync;
  t.after(() => { fs.linkSync = original; });
  fs.linkSync = (...args) => {
    fs.writeFileSync(destination, "external");
    return original(...args);
  };
  assert.throws(() => writeUploadFile(target, "new.txt", Buffer.from("ours"), "error"), /EEXIST/);
  assert.equal(fs.readFileSync(destination, "utf8"), "external");
  fs.unlinkSync(destination);
  assert.equal(writeUploadFile(target, "new.txt", Buffer.from("ours"), "skip"), "skipped");
  assert.equal(fs.readFileSync(destination, "utf8"), "external");
  assert.deepEqual(fs.readdirSync(target.directory), ["new.txt"]);
});

test("unsupported hard links use exclusive copy without overwriting concurrent arrivals", async t => {
  const { writeUploadFile } = await loadSubject();
  const target = writableFixture(t);
  const original = fs.linkSync;
  t.after(() => { fs.linkSync = original; });
  fs.linkSync = () => { throw Object.assign(new Error("links unsupported"), { code: "ENOTSUP" }); };
  assert.equal(writeUploadFile(target, "new.txt", Buffer.from("new"), "error"), "uploaded");
  assert.equal(fs.readFileSync(path.join(target.directory, "new.txt"), "utf8"), "new");
  const copy = fs.copyFileSync;
  t.after(() => { fs.copyFileSync = copy; });
  fs.copyFileSync = (...args) => { fs.writeFileSync(args[1], "concurrent"); return copy(...args); };
  assert.throws(() => writeUploadFile(target, "race.txt", Buffer.from("ours"), "error"), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(target.directory, "race.txt"), "utf8"), "concurrent");
  fs.unlinkSync(path.join(target.directory, "race.txt"));
  assert.equal(writeUploadFile(target, "race.txt", Buffer.from("ours"), "skip"), "skipped");
  assert.equal(fs.readFileSync(path.join(target.directory, "race.txt"), "utf8"), "concurrent");
});

test("staging cleanup never follows a parent swapped to an outside-root symlink", async t => {
  const { writeUploadFile } = await loadSubject();
  const target = writableFixture(t);
  const moved = target.directory + "-moved", outside = target.directory + "-outside";
  fs.mkdirSync(outside);
  t.after(() => { fs.rmSync(moved, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  const original = fs.writeFileSync;
  t.after(() => { fs.writeFileSync = original; });
  let sentinel;
  fs.writeFileSync = (...args) => {
    original(...args);
    const temporaryName = fs.readdirSync(target.directory).find(name => name.startsWith(".brabbler-upload-"));
    fs.renameSync(target.directory, moved);
    sentinel = path.join(outside, temporaryName);
    original(sentinel, "outside sentinel");
    fs.symlinkSync(outside, target.directory, process.platform === "win32" ? "junction" : "dir");
  };
  assert.throws(() => writeUploadFile(target, "new.txt", Buffer.from("ours"), "error"), /directory changed|Access denied/);
  fs.writeFileSync = original;
  assert.equal(fs.readFileSync(sentinel, "utf8"), "outside sentinel");
  assert.equal(fs.existsSync(path.join(outside, "new.txt")), false);
  assert.equal(fs.readdirSync(moved).length, 1, "retain inaccessible staging rather than deleting through a new parent");
});

test("Windows upload names reject aliases, streams and case-colliding duplicates", async () => {
  const { validateUploadFileNames } = loadTsModule(new URL("./file-upload.ts", import.meta.url), {
    fs, path, "node:crypto": { randomUUID }, "./path-security": {}, "./paths": {},
  }, { process: { platform: "win32" } }).exports;
  assert.equal(validateUploadFileNames(["normal.txt"]), null);
  for (const name of ["CON", "NUL.txt", "COM1.log", "file:stream", "trailing.", "trailing ", "bad?name"]) {
    assert.match(validateUploadFileNames([name]), /Invalid file name/);
  }
  assert.match(validateUploadFileNames(["File.txt", "file.txt"]), /Duplicate/);
});

test("parses only supported conflict strategies", async () => {
  const { parseUploadConflictStrategy } = await loadSubject();

  assert.equal(parseUploadConflictStrategy(null), "error");
  assert.equal(parseUploadConflictStrategy("overwrite"), "overwrite");
  assert.equal(parseUploadConflictStrategy("skip"), "skip");
  assert.equal(parseUploadConflictStrategy("rename"), null);
});
