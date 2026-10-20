import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { TabBar } = await jiti.import("./TabBar.tsx");

test("overflowing file and terminal tabs stretch above the scrollbar without fixed heights", () => {
  const tabs = Array.from({ length: 12 }, (_, index) => ({ id: `t${index}`, label: `file-${index}.ts`, filePath: `/p/file-${index}.ts`, ...(index === 11 ? { kind: "terminal" } : {}) }));
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(TabBar, { tabs, activeTabId: "t0", onSelectTab() {}, onCloseTab() {} })));
  function styles(role) {
    return [...html.matchAll(new RegExp(`<div role="${role}"[^>]* style="([^"]*)"`, "g"))].map(([, value]) =>
      Object.fromEntries(value.split(";").filter(Boolean).map((declaration) => {
        const colon = declaration.indexOf(":");
        return [declaration.slice(0, colon), declaration.slice(colon + 1)];
      })));
  }
  const [list] = styles("tablist");
  assert.equal(list.height, "36px");
  assert.equal(list["overflow-x"], "auto");
  assert.equal(list["overflow-y"], "hidden");
  assert.equal(list["align-items"], "stretch");
  const tabStyles = styles("tab");
  assert.equal(tabStyles.length, 12);
  for (const style of tabStyles) {
    assert.equal(style.height, undefined);
    assert.equal(style["align-items"], "center");
  }
});
