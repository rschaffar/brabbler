import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

// Resolve from the checked project, not this file: the same tests also run from
// demo/ against its independently installed ESLint and Next configuration.
const cwd = process.cwd();
const requireProject = createRequire(path.join(cwd, "package.json"));
const { ESLint } = requireProject("eslint");
const eslint = new ESLint({ cwd });
const filePath = path.join(cwd, "components/__eslint_compatibility_fixture__.tsx");

const cases = [
  {
    name: "missing image description",
    rule: "jsx-a11y/alt-text",
    severity: 1,
    code: 'export default function Probe() { return <img src="/probe.png" />; }',
  },
  {
    name: "invalid accessibility attribute",
    rule: "jsx-a11y/aria-props",
    severity: 1,
    code: 'export default function Probe() { return <div aria-bogus="true" />; }',
  },
  {
    name: "missing React list key",
    rule: "react/jsx-key",
    severity: 2,
    code: "export default function Probe() { return <div>{[1, 2].map(n => <span>{n}</span>)}</div>; }",
  },
  {
    name: "conditional React Hook",
    rule: "react-hooks/rules-of-hooks",
    severity: 2,
    code: 'import { useState } from "react"; export default function Probe({ flag }: { flag: boolean }) { if (flag) { useState(0); } return <div />; }',
  },
  {
    name: "anonymous default export",
    rule: "import/no-anonymous-default-export",
    severity: 1,
    code: "export default { probe: true };",
  },
  {
    name: "explicit TypeScript any",
    rule: "@typescript-eslint/no-explicit-any",
    severity: 2,
    code: "export function probe(value: any) { return value; }",
  },
  {
    name: "unoptimized Next image",
    rule: "@next/next/no-img-element",
    severity: 1,
    code: 'export default function Probe() { return <img src="/probe.png" alt="probe" />; }',
  },
];

for (const { name, rule, severity, code } of cases) {
  test(`configured lint detects ${name}`, async () => {
    const results = await eslint.lintText(code, { filePath });
    assert.equal(results.length, 1);
    const { messages } = results[0];
    assert.equal(messages.some((message) => message.fatal), false, JSON.stringify(messages));
    assert.ok(
      messages.some((message) => message.ruleId === rule && message.severity === severity),
      `Expected ${rule} at severity ${severity}: ${JSON.stringify(messages)}`,
    );
  });
}

test("configured lint accepts valid typed JSX", async () => {
  const results = await eslint.lintText(
    "export default function Probe({ label }: { label: string }) { return <span>{label}</span>; }",
    { filePath },
  );
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].messages, []);
});
