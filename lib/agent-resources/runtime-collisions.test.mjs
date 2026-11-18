import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";

// Runtime skill-collision admission over the actual compose()/skillsOverride
// owner with a captured construction snapshot. Catalog precedence/admission is
// owned by catalog.test; real loader startup by runtime.test.
const jiti = createJiti(import.meta.url, { fsCache: false, nativeModules: ["@earendil-works/pi-coding-agent"] });
const { prepareResourceRuntime } = await jiti.import("./runtime.ts");
const { createSelectionIdentity } = await jiti.import("./selection.ts");

async function fixture(t, { winnerEnabled = true, loserEnabled = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "resource-collisions-")));
  const previous = process.env.PI_CODING_AGENT_DIR;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; fs.rmSync(root, { recursive: true, force: true }); });
  const agentDir = join(root, "agent"), cwd = join(root, "project");
  fs.mkdirSync(agentDir); fs.mkdirSync(cwd); fs.writeFileSync(join(agentDir, "resource-catalog.json"), "{}\n");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const skill = name => { const path = join(root, name, "SKILL.md"); fs.mkdirSync(join(root, name)); fs.writeFileSync(path, "---\nname: duplicate\ndescription: d\n---\n"); return path; };
  const winner = skill("winner"), loser = skill("loser"), stranger = skill("stranger");
  const row = (path, enabled) => ({ kind: "skill", membership: "confirmed", path, observedPaths: [],
    identity: createSelectionIdentity({ agentDir, origin: { scope: "global" }, kind: "skill", path }), selection: { enabled } });
  const captured = { context: { agentDir }, cwd, catalog: { rows: [row(winner, winnerEnabled), row(loser, loserEnabled)] }, assertCurrent: async () => {} };
  const runtime = await prepareResourceRuntime({ cwd }, captured);
  const record = path => ({ name: "duplicate", filePath: path });
  const collision = (winnerPath, loserPath) => ({ type: "collision", message: 'name "duplicate" collision', path: loserPath,
    collision: { resourceType: "skill", name: "duplicate", winnerPath, loserPath } });
  const override = base => runtime.compose({}).skillsOverride(base);
  return { winner, loser, stranger, record, collision, override };
}

test("a native skill collision whose loser is not enabled is admitted and keeps the winner", async t => {
  const f = await fixture(t);
  const result = f.override({ skills: [f.record(f.winner)], diagnostics: [f.collision(f.winner, f.loser)] });
  assert.deepEqual(result.skills.map(skill => skill.filePath), [f.winner]);
});

test("a collision with an enabled loser, an unbound path or another skill error still refuses", async t => {
  const enabledLoser = await fixture(t, { loserEnabled: true });
  assert.throws(() => enabledLoser.override({ skills: [enabledLoser.record(enabledLoser.winner)], diagnostics: [enabledLoser.collision(enabledLoser.winner, enabledLoser.loser)] }),
    /skill loading failed/);
  const f = await fixture(t);
  assert.throws(() => f.override({ skills: [f.record(f.winner)], diagnostics: [f.collision(f.winner, f.stranger)] }), /skill loading failed/);
  assert.throws(() => f.override({ skills: [f.record(f.winner)], diagnostics: [{ type: "error", message: "broken", path: f.loser }] }), /skill loading failed/);
});
