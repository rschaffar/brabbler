import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { sameMoveDirectory, moveDirectoryOptions, filterMoveOptions } = await jiti.import("./SessionMoveDestinationPicker.tsx");

test("move filters match case-insensitive parts of names and paths without altering options", () => {
  const options = [
    { value: "/repo", label: "main · /repo (current directory)", disabled: true },
    { value: "/linked", label: "feature/Move-Picker · /linked" },
    { value: "/other", label: "topic · /other" },
  ];
  assert.deepEqual(filterMoveOptions(options, "   "), options);
  assert.deepEqual(filterMoveOptions(options, "MOVE link"), [options[1]]);
  assert.deepEqual(filterMoveOptions(options, "REPO"), [options[0]]);
  assert.deepEqual(filterMoveOptions(options, "missing"), []);
  assert.deepEqual(filterMoveOptions([{ value: "/Projects/Pi-Web", label: "/Projects/Pi-Web" }], " pi-web "), [{ value: "/Projects/Pi-Web", label: "/Projects/Pi-Web" }]);
});

test("exact current directory excludes neither siblings nor the rest of the project", () => {
  const worktrees = [{ path: "/repo", branch: "main", isMain: true }, { path: "/linked", branch: "feature" }];
  const options = moveDirectoryOptions("/repo", worktrees);
  assert.deepEqual(options, worktrees);
  assert.deepEqual(options.filter((item) => !sameMoveDirectory(item.path, "/repo/")), [worktrees[1]]);
  assert.deepEqual(options.filter((item) => !sameMoveDirectory(item.path, "/linked")), [worktrees[0]]);
});

test("another project's registered worktrees retain branch names and paths", () => {
  const worktrees = [{ path: "/other", branch: "other-main", isMain: true }, { path: "/other-linked", branch: "topic" }];
  assert.deepEqual(moveDirectoryOptions("/other", worktrees), worktrees);
  assert.ok(worktrees.every((item) => !sameMoveDirectory(item.path, "/repo")));
});

test("plain directories and repository subdirectories remain directly selectable", () => {
  assert.deepEqual(moveDirectoryOptions("/plain", []), [{ path: "/plain", branch: null }]);
  assert.deepEqual(moveDirectoryOptions("/repo/subdir", [{ path: "/repo", branch: "main" }]), [
    { path: "/repo/subdir", branch: null }, { path: "/repo", branch: "main" },
  ]);
});

test("current-directory equality handles Windows drive and UNC variants without folding POSIX paths", () => {
  assert.ok(sameMoveDirectory("C:\\Repo\\", "c:/repo"));
  assert.ok(sameMoveDirectory("\\\\Host\\Share\\Repo", "//host/share/repo/"));
  assert.ok(sameMoveDirectory("/", "/"));
  assert.ok(!sameMoveDirectory("/Repo", "/repo"));
  assert.ok(!sameMoveDirectory("/repo\\name", "/repo/name"));
});
