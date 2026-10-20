import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

// Authored offline with existing FFmpeg 9.0.2: color=c=blue:s=64x64:r=5:d=4,
// libvpx, g=5, b:v=20k, no audio/metadata, bitexact. SHA256 of decoded WebM:
// fdaead5cf50df7704ea43acde3b06cb66ae143a3cbb32f670e0f1eea52dbc213.
// Keep bytes in JS: fresh source export intentionally excludes binary fixtures.
const WEBM = "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAARiEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHGTbuMU6uEElTDZ1OsggEiTbuMU6uEHFO7a1OsggQU7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrXsYMPQkBNgIRMYXZmV0GETGF2ZkSJiECvQAAAAAAAFlSua9euAQAAAAAAAE7XgQFzxYgAAAAAAAAAAZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgkLCBQLqBQJqBAlWwhFW5gQFV7oEA7AEAAAAAAAACAAASVMNn0HNzzWPAi2PFiAAAAAAAAAABZ8iYRaOHRU5DT0RFUkSHi0xhdmMgbGlidnB4Z8ihRaOIRFVSQVRJT05Eh5MwMDowMDowNC4wMDAwMDAwMDAAH0O2dUKX54EAo8OBAACAkAMAnQEqQABAAABHCIWFiIWEiAICAnWqA/gCBuhBXDHSEwBVWAD+/00S//xYV/FhX8WFf/FhX/z8zu3F/OYAo5aBAMgA0QEAARAQABgAGFgv9AAIjoAAo5aBAZAA0QEAARAQABgAGFgv9AAIjoAAo5aBAlgA0QEAARAQABgAGFgv9AAIjoAAo5aBAyAA0QEAARAQABgAGFgv9AAIjoAAo8OBA+iAkAMAnQEqQABAAABHCIWFiIWEiAICAnWqA/gCBuhBXDHSEwBVWAD+/00S//xYV/FhX8WFf/FhX/z8zu3F/OYAo5aBBLAA0QEAARAQABgAGFgv9AAIjoAAo5aBBXgA0QEAARAQABgAGFgv9AAIjoAAo5aBBkAA0QEAARAQABgAGFgv9AAIjoAAo5aBBwgA0QEAARAQABgAGFgv9AAIjoAAo8OBB9CAkAMAnQEqQABAAABHCIWFiIWEiAICAnWqA/gCBuhBXDHSEwBVWAD+/00S//xYV/FhX8WFf/FhX/z8zu3F/OYAo5aBCJgA0QEAARAQABgAGFgv9AAIjoAAo5aBCWAA0QEAARAQABgAGFgv9AAIjoAAo5aBCigA0QEAARAQABgAGFgv9AAIjoAAo5aBCvAA0QEAARAQABgAGFgv9AAIjoAAo8OBC7iAkAMAnQEqQABAAABHCIWFiIWEiAICAnWqA/gCBuhBXDHSEwBVWAD+/00S//xYV/FhX8WFf/FhX/z8zu3F/OYAo5aBDIAA0QEAARAQABgAGFgv9AAIjoAAo5aBDUgA0QEAARAQABgAGFgv9AAIjoAAo5aBDhAA0QEAARAQABgAGFgv9AAIjoAAo5aBDtgA0QEAARAQABgAGFgv9AAIjoAAHFO7a8m7j7OBALeK94EB8YIBd/CBA7uQs4ID6LeK94EB8YIBd/CBqLuRs4IH0LeL94EB8YIBd/CCAU27kbOCC7i3i/eBAfGCAXfwggHy";

function wave() {
  const bytes = Buffer.alloc(44 + 4 * 8000 * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}

export function seedMarkdownMediaFixtures({ project, agentDir, writeSession, message }) {
  const id = "e5e10000-0000-4000-8000-000000000001", otherId = "e5e10000-0000-4000-8000-000000000002";
  const outside = join(agentDir, "outside-markdown-media"); mkdirSync(outside);
  const audio = join(project, "inline-take.wav"), video = join(project, "inline-demo.webm");
  const external = join(outside, "external.wav"), corrupt = join(project, "inline-corrupt.wav");
  writeFileSync(audio, wave()); writeFileSync(external, wave());
  const videoBytes = Buffer.from(WEBM, "base64");
  assert.equal(createHash("sha256").update(videoBytes).digest("hex"), "fdaead5cf50df7704ea43acde3b06cb66ae143a3cbb32f670e0f1eea52dbc213");
  writeFileSync(video, videoBytes); writeFileSync(corrupt, "not an audio file");
  writeSession(id, [
    message("media-user", null, "user", "Local media embeds\n\n![User recording](inline-take.wav)"),
    message("media-answer", "media-user", "assistant", [{ type: "text", text:
      `![Video demo](inline-demo.webm)\n\n![External recording](${external})\n\n![Corrupt recording](inline-corrupt.wav)\n\n![Remote demo](https://media.invalid/demo.mp4?v=2)\n\n![Encoded remote](https://media.invalid/clip.%6dp4)\n\n<img alt="Spaced remote" src="https://media.invalid/clip.mp4 ">\n\n![API media](/api/files/${audio.split("/").filter(Boolean).map(encodeURIComponent).join("/").replace(/wav$/, "%77av")}?type=read)\n\n[![Linked demo](inline-demo.webm)](https://media.invalid/docs)\n\n![Outside relative](../outside/other.wav)\n\n[Ordinary recording](inline-take.wav)` }]),
  ]);
  writeSession(otherId, [message("untrusted", null, "system", [{ type: "text", text: external }]), message("unrelated", "untrusted", "user", "Unrelated media session")]);
  return { id, otherId, audio, video, external, corrupt };
}

export async function checkMarkdownMedia(page, { base, fixtures: f }) {
  writeFileSync(f.corrupt, "not an audio file"); // Each viewport exercises the same failure first.
  const fileUrl = (file, id = f.id, type = "read") => `${base}/api/files/${file.split("/").filter(Boolean).map(encodeURIComponent).join("/")}?type=${type}${id ? `&sessionId=${id}` : ""}`;
  const paths = new Set([f.audio, f.video, f.external, f.corrupt].map(file => new URL(fileUrl(file)).pathname));
  const requests = [], forbidden = [], remote = [];
  const observe = request => {
    const url = new URL(request.url());
    if (paths.has(decodeURIComponent(url.pathname))) {
      requests.push(url);
      if (["edit", "save", "watch", "meta"].includes(url.searchParams.get("type"))) forbidden.push(request.url());
    }
    if (url.pathname === "/api/git/diff" && [f.audio, f.video, f.external, f.corrupt].includes(url.searchParams.get("path"))) forbidden.push(request.url());
    if (url.hostname === "media.invalid") remote.push(request.url());
  };
  page.on("request", observe);
  const media = label => page.locator(".markdown-media").filter({ has: page.locator(".markdown-media-label", { hasText: new RegExp(`^${label}$`) }) });
  const load = async (label, type) => {
    const box = media(label);
    await box.getByRole("button", { name: `Load ${type}: ${label}`, exact: true }).click();
    const element = box.locator(type);
    await element.waitFor();
    await page.waitForFunction(node => node.readyState >= 2 && Number.isFinite(node.duration) && node.duration > 3, await element.elementHandle());
    assert.equal(await element.getAttribute("preload"), "metadata");
    assert.equal(new URL(await element.getAttribute("src"), base).searchParams.get("sessionId"), f.id);
    return element;
  };
  const playAndSeek = async element => {
    await element.evaluate(node => node.play());
    await page.waitForFunction(node => !node.paused && node.currentTime > 0.1, await element.elementHandle());
    await element.evaluate(node => { node.pause(); node.currentTime = 2; });
    await page.waitForFunction(node => !node.seeking && Math.abs(node.currentTime - 2) < 0.1, await element.elementHandle());
    await element.evaluate(node => node.play());
    await page.waitForFunction(node => !node.paused && node.currentTime > 2.1, await element.elementHandle());
    await element.evaluate(node => node.pause());
  };
  const released = async handle => {
    await page.waitForFunction(node => node.paused && !node.hasAttribute("src") && node.readyState === 0, handle);
  };
  try {
    for (const id of ["", f.otherId]) {
      const denied = await fetch(fileUrl(f.external, id), { headers: { range: "bytes=0-15" } });
      assert.equal(denied.status, 403, "external file really requires its own eligible session reference"); await denied.arrayBuffer();
    }
    const ranged = await fetch(fileUrl(f.external), { headers: { range: "bytes=0-15" } });
    assert.equal(ranged.status, 206); assert.equal(ranged.headers.get("content-range"), `bytes 0-15/${wave().length}`);
    assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), wave().subarray(0, 16));
    for (const type of ["edit", "list"]) { const denied = await fetch(fileUrl(f.external, f.id, type)); assert.equal(denied.status, 403); await denied.arrayBuffer(); }
    await page.goto(`${base}/?session=${f.id}`, { waitUntil: "domcontentloaded" });
    await media("External recording").getByRole("button", { name: "Load audio: External recording", exact: true }).waitFor();
    await media("Video demo").scrollIntoViewIfNeeded();
    assert.equal(await page.locator(".markdown-media audio, .markdown-media video").count(), 0);
    assert.equal(requests.length, 0, "viewing settled embeds must not request any media API operation");
    assert.deepEqual(remote, []);
    assert.equal(await page.getByRole("link", { name: "Remote demo", exact: true }).getAttribute("href"), "https://media.invalid/demo.mp4?v=2");
    assert.equal(await page.getByRole("link", { name: "Linked demo", exact: true }).locator("audio, video, button, img").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Outside relative", exact: true }).getAttribute("aria-expanded"), "false");
    for (const box of await page.locator(".markdown-media").all()) {
      const bounds = await box.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width + 1, "media fits narrow chat");
    }
    const audio = await load("User recording", "audio"); await playAndSeek(audio);
    const audioHandle = await audio.elementHandle();
    await media("User recording").hover();
    assert.equal(await audioHandle.evaluate(node => node.isConnected), true, "message hover preserves native player identity");
    await media("User recording").getByRole("button", { name: "Unload player", exact: true }).click();
    await released(audioHandle);
    const video = await load("Video demo", "video"); await playAndSeek(video);
    assert.equal(await video.getAttribute("playsinline"), "");
    assert.equal(await video.evaluate(node => node.videoWidth === 64 && node.videoHeight === 64 && node.getVideoPlaybackQuality().totalVideoFrames > 0), true);
    const external = await load("External recording", "audio"); await playAndSeek(external);
    assert.ok(requests.some(url => url.pathname === new URL(fileUrl(f.external)).pathname && url.searchParams.get("type") === "read"));
    assert.deepEqual(forbidden, [], "inline playback has no metadata/watch/edit/Git probes");

    const bad = media("Corrupt recording");
    await bad.getByRole("button", { name: "Load audio: Corrupt recording", exact: true }).click();
    await bad.getByRole("status").waitFor();
    const badSrc = await bad.locator("audio").getAttribute("src");
    assert.match(await bad.getByRole("status").innerText(), /Unable to play/);
    assert.equal(await bad.getByRole("link", { name: "Download file", exact: true }).count(), 1);
    await bad.getByRole("button", { name: "Unload player", exact: true }).click();
    writeFileSync(f.corrupt, wave());
    const repaired = await load("Corrupt recording", "audio");
    assert.notEqual(await repaired.getAttribute("src"), badSrc, "explicit reload bypasses failed native-media cache");
    assert.equal(await bad.getByRole("status").count(), 0);

    // Opening Files covers mobile chat; desktop explicitly expands the panel.
    const externalHandle = await external.elementHandle();
    await media("External recording").getByRole("button", { name: "Open in Files", exact: true }).click();
    const panel = page.locator("#file-panel");
    await panel.locator("audio").waitFor();
    if (page.viewportSize().width > 640) await panel.getByRole("button", { name: "Expand file panel", exact: true }).click();
    await released(externalHandle);
    if (page.viewportSize().width > 640) await panel.getByRole("button", { name: "Restore file panel width", exact: true }).click();
    await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
    await media("External recording").getByRole("button", { name: "Load audio: External recording", exact: true }).waitFor();
    assert.equal(await page.locator(".markdown-media audio, .markdown-media video").count(), 0, "uncovering chat never resumes a player");
    // FileViewer legitimately watches; only inline playback above forbids watching.
    assert.equal(forbidden.some(url => /type=(?:edit|save)/.test(url) || url.includes("/api/git/diff")), false);
    if (page.viewportSize().width > 640) {
      const modalPlayer = await load("User recording", "audio");
      const modalHandle = await modalPlayer.elementHandle();
      await modalPlayer.evaluate(node => node.play());
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await released(modalHandle);
      await page.keyboard.press("Escape");
      await media("User recording").getByRole("button", { name: "Load audio: User recording", exact: true }).waitFor();
    }
    const last = await load("User recording", "audio");
    const lastHandle = await last.elementHandle(); await last.evaluate(node => node.play());
    // Use real SPA navigation, retaining the old DOM handle for teardown proof.
    const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await showSidebar.isVisible()) await showSidebar.click();
    await page.locator('#session-sidebar [title="Unrelated media session"]').click();
    await released(lastHandle);
    const deniedAgain = await fetch(fileUrl(f.external, "")); assert.equal(deniedAgain.status, 403); await deniedAgain.arrayBuffer();
    assert.deepEqual(remote, [], "remote media is a link, never a media/image request");
    console.log(`PASS: ${page.viewportSize().width}px explicit local media, real playback/seek, session authorization, errors and disposal`);
  } finally { page.off("request", observe); }
}
