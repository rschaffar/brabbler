import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { gitActionAttribution } = await createJiti(import.meta.url).import("./git-action-controller.ts");

const source = {
  projectRoot: "/same/project", cwd: "/same/project-worktrees/feature",
  commonDir: "/same/project/.git",
  identities: { common: { device: "1", inode: "2", birthtime: "3" } },
};
const target = { ...source, cwd: "/same/project", identities: { common: { ...source.identities.common } } };

test("captured project attribution pairs only checkouts from the same common Git directory instance", () => {
  assert.deepEqual(gitActionAttribution(source, target), {
    projectRoot: source.projectRoot, sourceCheckoutRoot: source.cwd, targetCheckoutRoot: target.cwd,
  });
  for (const key of ["device", "inode", "birthtime"]) {
    assert.throws(() => gitActionAttribution(source, {
      ...target, identities: { common: { ...target.identities.common, [key]: "different" } },
    }), /different captured repository/, `same paths do not excuse a changed ${key}`);
  }
  assert.throws(() => gitActionAttribution(source, { ...target, commonDir: "/other/.git" }), /different captured repository/);
  assert.throws(() => gitActionAttribution(source, { ...target, projectRoot: "/other" }), /different captured repository/);
  assert.deepEqual(gitActionAttribution(source), { projectRoot: source.projectRoot, sourceCheckoutRoot: source.cwd });
});
