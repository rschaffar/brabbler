import assert from "node:assert/strict";
import test from "node:test";

const { createJiti } = await import("jiti");
const { gitExecEnv } = await createJiti(import.meta.url).import("./git-exec.ts");

test("Git subprocess environment strips inherited redirects and config, with only an explicit private index", () => {
  const inherited = {
    PATH: "/usr/bin", HOME: "/home/example", LC_ALL: "fr_FR.UTF-8",
    GIT_DIR: "/other/.git", GIT_WORK_TREE: "/other", GIT_COMMON_DIR: "/other/.git",
    GIT_INDEX_FILE: "/other/index", GIT_CONFIG_SYSTEM: "/other/config",
    GIT_CONFIG_GLOBAL: "/other/global", GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/other/hooks", GIT_CEILING_DIRECTORIES: "/other",
    GIT_TERMINAL_PROMPT: "1", GIT_OPTIONAL_LOCKS: "1",
  };
  const clean = gitExecEnv(undefined, inherited);
  assert.deepEqual(clean, {
    PATH: "/usr/bin", HOME: "/home/example", LC_ALL: "C", GIT_TERMINAL_PROMPT: "0",
  });
  assert.equal(inherited.GIT_DIR, "/other/.git");
  assert.equal(inherited.GIT_INDEX_FILE, "/other/index");
  assert.deepEqual(gitExecEnv("/tmp/private-index", inherited), {
    ...clean, GIT_INDEX_FILE: "/tmp/private-index",
  });
});
