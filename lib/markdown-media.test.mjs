import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { resolveMarkdownMedia, markdownMediaFileUrl, releaseMarkdownMedia } = await jiti.import("./markdown-media.ts");

const cwd = "/workspace/project";
test("local media recognition reuses resolved paths and existing format maps", () => {
  for (const ext of ["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba"]) {
    assert.deepEqual(resolveMarkdownMedia(`out/take.${ext.toUpperCase()}`, cwd), { kind: "local", filePath: `${cwd}/out/take.${ext.toUpperCase()}`, type: "audio" });
  }
  for (const ext of ["mp4", "m4v", "webm", "mov", "ogv"]) assert.equal(resolveMarkdownMedia(`/outside/movie.${ext}`, cwd).type, "video");
  assert.deepEqual(resolveMarkdownMedia("file:///outside/a%23b%3Fc.wav#t=3", cwd), { kind: "local", filePath: "/outside/a#b?c.wav", type: "audio" });
  assert.equal(resolveMarkdownMedia("image.png", cwd), null);
  assert.equal(resolveMarkdownMedia("https://example.com/stream", cwd), null);
});

test("traversal, missing cwd and app URLs never become playable browser sources", () => {
  for (const href of ["../other/take.wav", "%2e%2e/other/take.wav"]) assert.deepEqual(resolveMarkdownMedia(href, cwd), { kind: "blocked", reason: "outside-root" });
  assert.deepEqual(resolveMarkdownMedia("take.wav"), { kind: "blocked", reason: "missing-base" });
  for (const href of ["/api/movie.mp4", "/api/files/tmp/take.%77av?type=read", "/api/files/tmp/take.mp\t4", "/_next/movie.mp4", "javascript:movie.mp4", "data:audio/movie.mp4", "blob:movie.mp4"]) assert.equal(resolveMarkdownMedia(href, cwd).kind, "unavailable");
  for (const href of ["https://example.com/clip.mp4?v=2#t=1", "https://example.com/clip.%6dp4", "https://example.com/clip.mp4 ", "https://example.com/clip.mp\t4", "//example.com/clip.webm"]) assert.deepEqual(resolveMarkdownMedia(href, cwd), { kind: "remote", href });
});

test("Windows and UNC identities survive generated session-scoped API URLs", () => {
  assert.equal(resolveMarkdownMedia("C:/work/take.wav", "C:/work").filePath, "C:/work/take.wav");
  const unc = resolveMarkdownMedia("file://host/share/take.wav", cwd);
  assert.equal(unc.filePath, "//host/share/take.wav");
  assert.equal(markdownMediaFileUrl(unc.filePath, "session & id"), "/api/files/%2F%2Fhost/share/take.wav?type=read&sessionId=session+%26+id");
  assert.equal(markdownMediaFileUrl("/tmp/a#b?c.wav", "id", true), "/api/files/tmp/a%23b%3Fc.wav?type=download&sessionId=id");
});

test("native release pauses then detaches the source and resets loading", () => {
  const calls = [];
  releaseMarkdownMedia({ pause: () => calls.push("pause"), removeAttribute: name => calls.push(["remove", name]), load: () => calls.push("load") });
  assert.deepEqual(calls, ["pause", ["remove", "src"], "load"]);
});
