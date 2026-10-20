import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { resolveSkillLink, skillInstructionsBody } = await createJiti(import.meta.url).import("./skill-instructions.ts");
test("skill instructions strip only display frontmatter", () => {
  assert.equal(skillInstructionsBody("---\nname: synthetic\ndescription: Fixture\n---\n\n# Body\n"), "# Body");
  assert.equal(skillInstructionsBody("# No frontmatter\n"), "# No frontmatter");
});
test("skill references resolve from the linking document with one decode", () => {
  assert.deepEqual(resolveSkillLink("../other.md#caf%C3%A9", "refs/nested.md"), { document: "other.md", anchor: "café" });
  assert.deepEqual(resolveSkillLink("#heading", "refs/nested.md"), { document: "refs/nested.md", anchor: "heading" });
  assert.deepEqual(resolveSkillLink("../../outside.md", "refs/nested.md"), { document: "../outside.md", anchor: "" });
  assert.deepEqual(resolveSkillLink("%252e%252e%252foutside.md", "SKILL.md"), { document: "%2e%2e%2foutside.md", anchor: "" });
  assert.deepEqual(resolveSkillLink("/absolute.md", "SKILL.md"), { document: "/absolute.md", anchor: "" });
});
