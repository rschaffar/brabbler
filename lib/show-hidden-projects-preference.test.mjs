import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getShowHiddenProjects, saveShowHiddenProjects } = await createJiti(import.meta.url).import("./show-hidden-projects-preference.ts");
const key = "brabbler-show-hidden-projects";
const storage = (initial) => {
  const values = new Map(initial === undefined ? [] : [[key, initial]]);
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test("only an explicit true preference reveals hidden projects", () => {
  for (const value of [undefined, "false", "1", "invalid", "TRUE"]) {
    assert.equal(getShowHiddenProjects(storage(value)), false);
  }
  assert.equal(getShowHiddenProjects(storage("true")), true);
});

test("reveal and conceal round-trip without changing another browser's preference", () => {
  const browser = storage();
  const phone = storage();
  saveShowHiddenProjects(true, browser);
  assert.equal(getShowHiddenProjects(browser), true);
  assert.equal(getShowHiddenProjects(phone), false);
  saveShowHiddenProjects(false, browser);
  assert.equal(getShowHiddenProjects(browser), false);
});

test("missing or blocked storage is safe", () => {
  const blocked = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  for (const value of [null, blocked]) {
    assert.equal(getShowHiddenProjects(value), false);
    assert.doesNotThrow(() => saveShowHiddenProjects(true, value));
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    get localStorage() { throw Error("blocked"); },
  } });
  try {
    assert.equal(getShowHiddenProjects(), false);
    assert.doesNotThrow(() => saveShowHiddenProjects(true));
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  }
});
