import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { GET, POST } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { selectGitProjectResources, revalidateGitProjectResources } = await jiti.import("../../../../lib/git-project-resources.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const status = (repositoryPath, checkoutPath, extra = {}) => GET(new Request(`http://localhost/api/git/inspection?${new URLSearchParams({ repositoryPath, checkoutPath, ...extra })}`));
const review = (repositoryPath, checkoutPath, extra = {}) => POST(new Request("http://localhost/api/git/inspection", { method: "POST", body: JSON.stringify({ repositoryPath, checkoutPath, targetBranch: "main", selection: { kind: "merge" }, ...extra }) }));
function fixture(t, parent, name) {
  const root = join(parent, name), feature = join(parent, `${name}-feature`), other = join(parent, `${name}-other`);
  git(parent, "init", "-qb", "main", root);
  git(root, "-c", "user.name=Test", "-c", "user.email=t@example.invalid", "commit", "--allow-empty", "-qm", "base");
  for (const [branch, cwd] of [["feature", feature], ["other", other]]) {
    git(root, "worktree", "add", "-qb", branch, cwd);
    writeFileSync(join(cwd, "source.txt"), `${name}-${branch}\n`);
    git(cwd, "add", "source.txt");
    git(cwd, "-c", "user.name=Test", "-c", "user.email=t@example.invalid", "commit", "-qm", branch);
  }
  allowFileRoot(root); allowFileRoot(feature); allowFileRoot(other);
  return { root, feature, other };
}

test("browser read-only status/review alternates A/worktree1 → B/checkout → A/worktree2 without session movement", { skip: process.platform !== "linux" }, async (t) => {
  const parent = mkdtempSync(join(tmpdir(), "pi-inspection-")); t.after(() => rmSync(parent, { recursive: true, force: true }));
  const a = fixture(t, parent, "a"), b = fixture(t, parent, "b");
  const tips = [a, b].map(({ root }) => git(root, "rev-parse", "HEAD"));
  for (const [root, cwd, branch, marker] of [[a.root, a.feature, "feature", "a-feature"], [b.root, b.root, "main", null], [a.root, a.other, "other", "a-other"]]) {
    const response = await status(root, cwd, { workspaceBranch: branch });
    assert.equal(response.status, 200);
    // B's primary checkout is a valid status resource; comparison of A's two linked checkouts is independent.
    if (marker) {
      const diff = await review(root, cwd, { workspaceBranch: branch });
      assert.equal(diff.status, 200);
      const body = await diff.json();
      assert.match(body.diff.patch, new RegExp(marker));
      assert.equal(body.approval, false);
      assert.equal(body.selection.cwd, cwd);
    }
  }
  assert.deepEqual([a, b].map(({ root }) => git(root, "rev-parse", "HEAD")), tips);
  assert.equal((await review(a.root, a.feature, { targetBranch: "missing" })).status, 409);
  assert.equal((await status(a.root, b.feature)).status, 409, "duplicate branch names in distinct repos never cross registrations");
  assert.equal((await status(a.feature, a.other)).status, 400, "canonical root required");
  assert.equal((await review(a.root, a.feature, { operation: "commit" })).status, 400);
  assert.equal((await status(a.root, a.feature, { operation: "commit" })).status, 400);
  const captured = await selectGitProjectResources(a.root, "feature", a.feature);
  const old = `${a.root}-old`; renameSync(a.root, old); cpSync(old, a.root, { recursive: true });
  await assert.rejects(revalidateGitProjectResources(captured), "replaced root invalidates captured selector despite matching paths and refs");
});

test("browser selectors reject denied canonical and checkout roots before review", async (t) => {
  const parent = mkdtempSync(join(tmpdir(), "pi-inspection-denied-")); t.after(() => rmSync(parent, { recursive: true, force: true }));
  const a = fixture(t, parent, "allowed"), hidden = join(parent, "hidden");
  git(parent, "init", "-qb", "main", hidden);
  git(hidden, "-c", "user.name=Test", "-c", "user.email=t@example.invalid", "commit", "--allow-empty", "-qm", "base");
  assert.equal((await status(hidden, hidden)).status, 403);
  assert.equal((await review(hidden, hidden)).status, 403);
  const outside = join(parent, "outside"); git(a.root, "worktree", "add", "-qb", "outside", outside);
  assert.equal((await status(a.root, outside)).status, 403);
  assert.equal((await review(a.root, outside)).status, 403);
});
