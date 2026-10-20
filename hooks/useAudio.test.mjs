import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";

const file = new URL("./useAudio.ts", import.meta.url);
const script = new Script(ts.transpileModule(await readFile(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { filename: file.pathname });

for (const blocked of ["property", "methods"]) {
  test(`audio toggle works with blocked storage ${blocked}`, () => {
    const window = blocked === "property" ? Object.defineProperty({}, "localStorage", {
      get() { throw new Error("Storage blocked"); },
    }) : { localStorage: { getItem() { throw new Error("Read blocked"); }, setItem() { throw new Error("Write blocked"); } } };
    let state;
    const exports = {};
    script.runInNewContext({ exports, window, require(name) {
      assert.equal(name, "react");
      return {
        useState(initial) { state = initial(); return [state, next => { state = next; }]; },
        useRef(current) { return { current }; },
        useCallback(fn) { return fn; },
        useEffect(fn) { fn(); },
      };
    } });
    const audio = exports.useAudio();
    assert.equal(audio.soundEnabled, true);
    audio.onSoundToggle();
    assert.equal(state, false);
    assert.equal(audio.soundEnabledRef.current, false);
    audio.onSoundToggle();
    assert.equal(state, true);
    assert.equal(audio.soundEnabledRef.current, true);
  });
}
