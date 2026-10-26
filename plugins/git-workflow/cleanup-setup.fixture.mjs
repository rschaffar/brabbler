import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const ignores = "node_modules/\n.codegraph/\n.next/\ntest-results/\nnext-env.d.ts\nunknown/\n";
const options = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };

/** Only private initial setup: all eleven native Git commands remain ordered.
 * Production observations/effects and every settings write use their real owners. */
export function setupCleanupRepository(root, repo, path) {
  if (process.platform === "win32") {
    // Do not require a POSIX shell where the original fixture needed only Git.
    const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgSign=false", ...args], options).trim();
    git(root, "init", "-qb", "main", repo); git(repo, "config", "user.name", "Fixture"); git(repo, "config", "user.email", "fixture@example.invalid");
    writeFileSync(join(repo, ".gitignore"), ignores);
    writeFileSync(join(repo, "source"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-qm", "Base");
    git(repo, "worktree", "add", "-b", "feature", path);
    writeFileSync(join(path, "source"), "feature\n"); git(path, "add", "."); git(path, "commit", "-qm", "Feature");
    const featureTip = git(path, "rev-parse", "HEAD");
    git(repo, "merge", "--no-ff", "--no-edit", "feature");
    return { featureTip, integrationCommit: git(repo, "rev-parse", "HEAD") };
  }
  // Fixed program, never interpolated paths/source. The shell waits for each Git
  // child and exits at the first failure; execFileSync drains and joins the shell.
  const output = execFileSync("sh", ["-eu", "-c", `
root=$1 repo=$2 feature=$3
at() { directory=$1; shift; command git -C "$directory" -c commit.gpgSign=false "$@"; }
{
  at "$root" init -qb main "$repo"
  at "$repo" config user.name Fixture
  at "$repo" config user.email fixture@example.invalid
  printf '%s' "$4" > "$repo/.gitignore"
  printf '%s\\n' base > "$repo/source"
  at "$repo" add .
  at "$repo" commit -qm Base
  at "$repo" worktree add -b feature "$feature"
  printf '%s\\n' feature > "$feature/source"
  at "$feature" add .
  at "$feature" commit -qm Feature
  feature_tip=$(at "$feature" rev-parse HEAD)
  at "$repo" merge --no-ff --no-edit feature
  integration_commit=$(at "$repo" rev-parse HEAD)
} >&2
printf '%s\\n%s\\n' "$feature_tip" "$integration_commit"
`, "cleanup-fixture", root, repo, path, ignores], options);
  // Only full OIDs cross this boundary, never line-framed filesystem paths.
  const ids = /^([0-9a-f]{40}(?:[0-9a-f]{24})?)\r?\n([0-9a-f]{40}(?:[0-9a-f]{24})?)\r?\n$/.exec(output);
  if (!ids || ids[0] !== output) throw new Error("Invalid cleanup fixture commit IDs");
  return { featureTip: ids[1], integrationCommit: ids[2] };
}
