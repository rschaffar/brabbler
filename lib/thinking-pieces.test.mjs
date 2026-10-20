import assert from "node:assert/strict";
import test from "node:test";
import { splitThinkingPieces, THINKING_PIECE_CHARS as n } from "./message-display.ts";

test("thinking pieces reconstruct exact text including empty/CRLF lines and Unicode", () => {
  for (const text of ["", "short", "\n", "x".repeat(n), "界".repeat(10*n), "😀".repeat(10*n), "a".repeat(n)+"\n\n\r\n"+"b".repeat(3*n), "a".repeat(n)+"\n", "x".repeat(2*n-1)+"😀"+"end".repeat(n)]) {
    const pieces = splitThinkingPieces(text);
    assert.equal(pieces.map(p => p.text + (p.lineBreak ? "\n" : "")).join(""), text);
    assert.ok(pieces.every(p => p.text.length <= 2*n+2 && p.text.isWellFormed()));
  }
});

test("appending thinking preserves completed pieces without memo-retaining old strings", () => {
  const initial = "界".repeat(3*n)+"\n"+"tail";
  const before = splitThinkingPieces(initial);
  const after = splitThinkingPieces(initial+" changed".repeat(n));
  assert.deepEqual(after.slice(0, before.length-1), before.slice(0,-1));
});
