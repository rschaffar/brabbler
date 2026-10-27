import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function setup(t) {
  const { createJiti } = await import("jiti");
  const api = await createJiti(import.meta.url).import("./file-edit.ts");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "brabbler-edit-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "root");
  fs.mkdirSync(root);
  const file = path.join(root, "notes.md");
  fs.writeFileSync(file, "first\n", { mode: 0o644 });
  return { ...api, base, root, file, roots: new Set([root]) };
}

test("edit snapshot and save preserve bytes, mode and reject a stale revision", async (t) => {
  const { file, roots, loadEditableFile, saveEditableFile } = await setup(t);
  const original = loadEditableFile(file, roots);
  assert.equal(original.content, "first\n");
  assert.equal(original.writable, true);
  assert.match(original.editIdentity, /^[a-f0-9]{64}$/);
  const originalMode = fs.statSync(file).mode & 0o777;
  const saved = saveEditableFile(file, roots, "second\n", original.revision);
  assert.equal(fs.readFileSync(file, "utf8"), "second\n");
  assert.equal(fs.statSync(file).mode & 0o777, originalMode);
  assert.equal(loadEditableFile(file, roots).revision, saved.revision);
  assert.equal(loadEditableFile(file, roots).editIdentity, original.editIdentity, "replace-save must not create a second edit owner");
  assert.throws(() => saveEditableFile(file, roots, "stale", original.revision), { status: 409 });
  assert.equal(fs.readFileSync(file, "utf8"), "second\n");
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["notes.md"]);
});

test("admitted parent aliases share a stable edit identity without admitting target symlinks", async (t) => {
  const { file, root, roots, loadEditableFile } = await setup(t);
  fs.symlinkSync(root, path.join(root, "alias"), "dir");
  assert.equal(loadEditableFile(path.join(root, "alias", "notes.md"), roots).editIdentity, loadEditableFile(file, roots).editIdentity);
  fs.chmodSync(file, 0o444);
  assert.equal(loadEditableFile(file, roots).editIdentity, undefined, "read-only admission is not editor admission");
});

test("a retargeted parent alias cannot redirect a draft even with identical baseline bytes", async (t) => {
  const { root, roots, loadEditableFile, saveEditableFile } = await setup(t);
  for (const name of ["one", "two"]) { fs.mkdirSync(path.join(root, name)); fs.writeFileSync(path.join(root, name, "same.txt"), "baseline"); }
  const alias = path.join(root, "current");
  fs.symlinkSync(path.join(root, "one"), alias, "dir");
  const file = path.join(alias, "same.txt"), snapshot = loadEditableFile(file, roots);
  fs.unlinkSync(alias); fs.symlinkSync(path.join(root, "two"), alias, "dir");
  assert.throws(() => saveEditableFile(file, roots, "draft", snapshot.revision, snapshot.editIdentity), { status: 409 });
  assert.equal(fs.readFileSync(path.join(root, "two", "same.txt"), "utf8"), "baseline");
});

test("edit reads the whole file beyond the chunked 256 KB preview", async (t) => {
  const { file, roots, loadEditableFile, saveEditableFile, MAX_EDIT_BYTES } = await setup(t);
  const content = "é\n".repeat(120_000);
  assert.ok(Buffer.byteLength(content) > 256 * 1024 && Buffer.byteLength(content) < MAX_EDIT_BYTES);
  fs.writeFileSync(file, content);
  const snapshot = loadEditableFile(file, roots);
  assert.equal(snapshot.content, content);
  saveEditableFile(file, roots, content + "end\n", snapshot.revision);
  assert.equal(fs.readFileSync(file, "utf8"), content + "end\n");
});

test("external edits, even with unchanged size, cannot be overwritten", async (t) => {
  const { file, roots, loadEditableFile, saveEditableFile } = await setup(t);
  const revision = loadEditableFile(file, roots).revision;
  fs.writeFileSync(file, "other\n");
  assert.throws(() => saveEditableFile(file, roots, "draft", revision), { status: 409 });
  assert.equal(fs.readFileSync(file, "utf8"), "other\n");
});

test("only allowed regular, non-symlink, writable targets can be edited", async (t) => {
  const { base, root, file, roots, loadEditableFile, saveEditableFile } = await setup(t);
  const revision = loadEditableFile(file, roots).revision;
  const outside = path.join(base, "outside.txt");
  fs.writeFileSync(outside, "safe");
  const link = path.join(root, "link.txt");
  fs.symlinkSync(outside, link);
  const innerLink = path.join(root, "inner.txt");
  fs.symlinkSync(file, innerLink);
  const parentLink = path.join(root, "escape");
  fs.symlinkSync(base, parentLink, "dir");
  for (const target of [outside, link, path.join(parentLink, "outside.txt"), innerLink]) {
    assert.throws(() => loadEditableFile(target, roots));
    assert.throws(() => saveEditableFile(target, roots, "bad", revision));
  }
  assert.equal(fs.readFileSync(outside, "utf8"), "safe");
  fs.chmodSync(file, 0o444);
  assert.equal(loadEditableFile(file, roots).writable, false);
  assert.throws(() => saveEditableFile(file, roots, "bad", revision), { status: 403 });
  fs.chmodSync(file, 0o644);
  fs.chmodSync(root, 0o555);
  assert.equal(loadEditableFile(file, roots).writable, false);
  assert.throws(() => saveEditableFile(file, roots, "bad", revision), { status: 403 });
  fs.chmodSync(root, 0o755);
  assert.equal(fs.readFileSync(file, "utf8"), "first\n");
});

test("binary, invalid UTF-8, media, oversized and malformed saves fail without changing the file", async (t) => {
  const { file, root, roots, MAX_EDIT_BYTES, loadEditableFile, saveEditableFile } = await setup(t);
  const revision = loadEditableFile(file, roots).revision;
  assert.throws(() => saveEditableFile(file, roots, "x".repeat(MAX_EDIT_BYTES + 1), revision), { status: 413 });
  assert.throws(() => saveEditableFile(file, roots, "a\0b", revision), { status: 415 });
  assert.throws(() => saveEditableFile(file, roots, "bad", "bad"), { status: 400 });
  fs.writeFileSync(file, Buffer.from([0xff, 0xfe]));
  assert.throws(() => loadEditableFile(file, roots), { status: 415 });
  fs.writeFileSync(file, Buffer.from([0x00, 0x01]));
  assert.throws(() => loadEditableFile(file, roots), { status: 415 });
  fs.writeFileSync(file, "x".repeat(MAX_EDIT_BYTES + 1));
  assert.throws(() => loadEditableFile(file, roots), { status: 413 });
  const image = path.join(root, "image.png");
  fs.writeFileSync(image, "text");
  assert.throws(() => loadEditableFile(image, roots), { status: 415 });
  assert.equal(fs.readFileSync(image, "utf8"), "text");
  assert.ok(fs.statSync(file).size > MAX_EDIT_BYTES);
});
