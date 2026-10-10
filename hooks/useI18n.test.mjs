import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider, useI18n } = await jiti.import("./useI18n.tsx");

function Probe() {
  const context = useI18n();
  assert.deepEqual(Object.keys(context).sort(), ["locale", "t"]);
  return React.createElement("span", { lang: context.locale }, context.t("sidebar.changedFiles", { count: 2 }));
}

test("renders English UI messages without touching browser preferences", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, get() { throw new Error("Browser preferences must not be accessed"); } });
  try {
    const html = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(Probe)));
    assert.equal(html, '<span lang="en">2 changed files</span>');
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else delete globalThis.window;
  }
});
