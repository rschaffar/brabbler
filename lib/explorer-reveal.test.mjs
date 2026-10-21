import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { explorerPathKey, explorerContains, explorerRevealRoot } = await createJiti(import.meta.url).import("./explorer-reveal.ts");

test("Explorer lexical identity preserves POSIX names and folds Windows drives/UNC", () => {
  assert.notEqual(explorerPathKey("/repo/File"), explorerPathKey("/repo/file"));
  assert.notEqual(explorerPathKey("/repo/a\\b"), explorerPathKey("/repo/a/b"));
  assert.equal(explorerPathKey("C:\\Repo\\File"), explorerPathKey("c:/repo/file"));
  assert.equal(explorerPathKey("C:/"), explorerPathKey("c:/"));
  assert.equal(explorerPathKey("\\\\HOST\\Share\\File"), explorerPathKey("//host/share/file"));
  assert.equal(explorerContains("/repo", "/repository/file"), false);
  assert.equal(explorerContains("/", "/file"), true);
  assert.equal(explorerContains("C:/", "c:\\file"), true);
  assert.equal(explorerContains("//HOST/Share/", "//host/share/folder/file"), true);
  assert.equal(explorerContains("//host/share", "//host/share-other/file"), false);
  assert.equal(explorerContains("/repo", "/repo/name%20with#L12"), true, "literal file paths are not URI/source-location parsed");
});

test("reveal retains a containing Explorer root, otherwise uses cwd or the exact parent", () => {
  assert.equal(explorerRevealRoot("/repo/nested/file", "/repo"), "/repo");
  assert.equal(explorerRevealRoot("/other/second", "/repo", "/other"), "/other");
  assert.equal(explorerRevealRoot("/repo/file", "/repo", "/other"), "/repo");
  assert.equal(explorerRevealRoot("/other/nested/file", "/repo"), "/other/nested");
  assert.equal(explorerRevealRoot("/file", "/repo"), "/");
  assert.equal(explorerRevealRoot("C:\\file", "D:/repo"), "C:/");
  assert.equal(explorerRevealRoot("\\\\Host\\Share\\file", "C:/repo"), "//Host/Share");
});
