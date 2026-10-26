import assert from "node:assert/strict";
import test from "node:test";
import { getMarkdownListContinuation } from "./markdown-list-continuation.ts";

function breakLine(input) {
  const caret = input.indexOf("|");
  const value = input.slice(0, caret) + input.slice(caret + 1);
  const edit = getMarkdownListContinuation(value, caret, caret);
  if (!edit) return null;
  return value.slice(0, edit.start) + edit.text + "|" + value.slice(edit.end);
}

test("continues ordered, bullet, task and Chinese enumeration markers", () => {
  for (const [input, expected] of [
    ["1. first|", "1. first\n2. |"], ["1) first|", "1) first\n2) |"],
    ["9. ninth|", "9. ninth\n10. |"], ["09. ninth|", "09. ninth\n10. |"],
    ["1.  wide gap|", "1.  wide gap\n2.  |"],
    ["- apple|", "- apple\n- |"], ["* apple|", "* apple\n* |"], ["+ apple|", "+ apple\n+ |"],
    ["- [x] done|", "- [x] done\n- [ ] |"], ["1. [X] done|", "1. [X] done\n2. [ ] |"],
    ["1、第一项|", "1、第一项\n2、|"], ["1、 第一项|", "1、 第一项\n2、 |"],
    ["1. first|second", "1. first\n2. |second"],
    ["1. parent\n   - child|", "1. parent\n   - child\n   - |"],
    ["- a\n\t2. tabbed|", "- a\n\t2. tabbed\n\t3. |"],
  ]) assert.equal(breakLine(input), expected, input);
});

test("an empty item ends the list", () => {
  for (const input of ["- a\n- |", "- a\n- [ ] |", "- a\n- [ ]|", "- a\n  -   |", "- a\n2、|"]) {
    assert.equal(breakLine(input), "- a\n|", input);
  }
});

test("ordinary text, selections, marker interiors and code keep native newlines", () => {
  for (const input of [
    "plain text|", "-no space|", "**bold**|", "1.5 meters|", "2024.|", "---|", "* * *|", "- - -|", "#1. heading|", "2020、2021年|",
    "|1. first", "1.| first", "  |- nested", "    - indented code|", "\t1. indented code|",
    "```\n- code|", "~~~md\n1. code|", "````\n```\n- still code|",
    "1. parent\n    ```\n    - code|", "- ```\n  - code|", "- parent\n\n      - code|", "1. parent\n\n       1. code|",
  ]) assert.equal(breakLine(input), null, input);
  assert.equal(getMarkdownListContinuation("1. first", 3, 8), null);
  assert.equal(breakLine("```\ncode\n```\n- list|"), "```\ncode\n```\n- list\n- |");
  assert.equal(breakLine("- ```\n  code\n  ```\n- list|"), "- ```\n  code\n  ```\n- list\n- |");
});

// The other three browser literals already occur in the existing cases above.
// Add only the exact task text and exact ordered-empty tuple that were absent.
test('literal browser finished-task and ordered-empty vectors use the real edit plan', () => {
  const task = '- [x] finished';
  const taskEdit = getMarkdownListContinuation(task, 14, 14);
  assert.equal(taskEdit !== null, true);
  assert.equal(taskEdit.start, 14);
  assert.equal(taskEdit.end, 14);
  assert.equal(taskEdit.text, '\n- [ ] ');
  const empty = '1. first\n2. ';
  const emptyEdit = getMarkdownListContinuation(empty, 12, 12);
  assert.equal(emptyEdit !== null, true);
  assert.equal(emptyEdit.start, 9);
  assert.equal(emptyEdit.end, 12);
  assert.equal(emptyEdit.text, '');
});
