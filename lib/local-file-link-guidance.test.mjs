import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import ts from "typescript";

const jiti = createJiti(import.meta.url);
const { createLocalFileLinkGuidanceExtension, LOCAL_FILE_LINK_GUIDELINES } = await jiti.import("./local-file-link-guidance.ts");
const { buildSystemPrompt } = await import(new URL("core/system-prompt.js", import.meta.resolve("@earendil-works/pi-coding-agent")));

function handler() {
  let callback;
  const extension = createLocalFileLinkGuidanceExtension();
  assert.equal(extension.name, "brabbler-local-file-link-guidance");
  assert.equal(extension.hidden, true);
  extension.factory({ on(name, fn) { assert.equal(name, "before_agent_start"); callback = fn; } });
  return callback;
}

test("host guidelines augment existing rules once, without replacing prompts or messages", () => {
  const run = handler();
  const options = { cwd: "/repo", promptGuidelines: ["Keep an existing rule"], sections: { custom: "Keep my section" } };
  for (const messageType of ["user", "steering", "followUp"]) {
    assert.equal(run({ messageType, systemPromptOptions: options }), undefined);
  }
  assert.deepEqual(options.promptGuidelines, ["Keep an existing rule", ...LOCAL_FILE_LINK_GUIDELINES]);
  const rendered = buildSystemPrompt(options);
  for (const rule of LOCAL_FILE_LINK_GUIDELINES) assert.ok(rendered.includes(rule));
  assert.match(rendered, /Keep an existing rule/);
  assert.match(rendered, /Keep my section/);
  assert.match(rendered, /absolute filesystem destinations/);
  assert.match(rendered, /Never prepend Brabbler's hostname/);
  assert.match(rendered, /#L36-L48/);
  assert.match(rendered, /Filesystem existence checks alone do not prove/);
  assert.equal(options.forceSystemPrompt, undefined);
  // Respect SDK custom-prefix and exact-replacement semantics.
  assert.doesNotMatch(buildSystemPrompt({ ...options, customPrompt: "Custom prefix" }), /absolute filesystem destinations/);
  assert.equal(buildSystemPrompt({ ...options, forceSystemPrompt: "Exact profile" }), "Exact profile");
});

test("guidance survives real resource-loader reloads with user extensions disabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-file-link-guidance-"));
  try {
    const loader = new DefaultResourceLoader({
      cwd: root, agentDir: join(root, "agent"),
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [createLocalFileLinkGuidanceExtension()],
    });
    for (let i = 0; i < 2; i++) {
      await loader.reload();
      const loaded = loader.getExtensions();
      assert.deepEqual(loaded.errors, []);
      const handlers = loaded.extensions.flatMap(extension => extension.handlers.get("before_agent_start") ?? []);
      assert.equal(handlers.length, 1);
      const options = { cwd: root, promptGuidelines: [] };
      await handlers[0]({ systemPromptOptions: options }, {});
      assert.deepEqual(options.promptGuidelines, [...LOCAL_FILE_LINK_GUIDELINES]);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

function properties(source, name) {
  const found = [];
  const visit = node => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === name) found.push(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
const parse = async name => ts.createSourceFile(name, await readFile(new URL(name, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const factoriesOf = (source, branch) => branch.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(source) === "extensionFactories").initializer;
const directCalls = (source, array) => array.elements.filter(ts.isCallExpression).map(n => n.expression.getText(source));

test("ordinary coding sessions get host guidance but Chat-only and exact children do not", async () => {
  const source = await parse("rpc-manager.ts");
  const [options] = properties(source, "resourceLoaderOptions");
  const ordinary = options.whenFalse;
  assert.equal(ordinary.condition.getText(source), "chatOnly");
  assert.ok(!directCalls(source, factoriesOf(source, ordinary.whenTrue)).includes("createLocalFileLinkGuidanceExtension"));
  assert.equal(directCalls(source, factoriesOf(source, ordinary.whenFalse)).filter(name => name === "createLocalFileLinkGuidanceExtension").length, 1);
  const reopened = factoriesOf(source, options.whenTrue).elements.find(n => ts.isSpreadElement(n) && n.getText(source).includes("createLocalFileLinkGuidanceExtension"));
  const select = new Function("usesExactSystemPrompt", "exactSystemPromptExtension", "createLocalFileLinkGuidanceExtension", `return (${reopened.expression.getText(source)});`);
  assert.deepEqual(select(true, "exact", () => "guidance"), ["exact"]);
  assert.deepEqual(select(false, "exact", () => "guidance"), ["guidance"]);

  const childSource = await parse("subagent-runtime.ts");
  const fresh = properties(childSource, "extensionFactories")[0].elements.find(n => ts.isSpreadElement(n) && n.getText(childSource).includes("createLocalFileLinkGuidanceExtension"));
  const selectChild = new Function("chatOnly", "promptPlan", "createLocalFileLinkGuidanceExtension", `return (${fresh.expression.getText(childSource)});`);
  assert.deepEqual(selectChild(false, {}, () => "guidance"), ["guidance"]);
  assert.deepEqual(selectChild(true, {}, () => "guidance"), []);
  assert.deepEqual(selectChild(false, { exactSystemPrompt: "profile" }, () => "guidance"), []);
  assert.deepEqual(selectChild(false, { exactSystemPrompt: "" }, () => "guidance"), []);
});
