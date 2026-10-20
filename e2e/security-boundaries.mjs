import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export async function checkRequestHeaderBoundary(base) {
  const ordinary = await fetch(`${base}/api/sessions`);
  assert.equal(ordinary.status, 200);
  await ordinary.arrayBuffer();
  for (const pathname of ["/api/sessions", "/"]) {
    for (const headers of [
      { "x-prerender-revalidate": "synthetic-not-a-preview-secret" },
      { "X-Prerender-Revalidate": "" },
      { "x-prerender-revalidate-if-generated": "" },
      { "x-prerender-revalidate": "synthetic", origin: "https://untrusted.invalid" },
    ]) {
      const response = await fetch(`${base}${pathname}`, { headers, redirect: "manual", signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 400, "installed launcher must reject header presence before Next dispatch");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("connection"), "close");
      assert.equal(await response.text(), "Invalid request headers");
    }
  }
  console.log("PASS: immutable installed launcher rejects revalidation headers without reading preview secrets");
}

export function seedExternalReferenceFixtures({ agentDir, writeSession, message }) {
  const outside = join(agentDir, "outside-reference-fixtures");
  mkdirSync(outside);
  const fixtures = ["system", "tool", "custom", "literal", "intentional"].map((kind, index) => {
    const id = `e5e00000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const file = join(outside, `${kind}.txt`);
    writeFileSync(file, `SAFE_REFERENCE_SENTINEL\n${kind} line two\n`);
    const text = [{ type: "text", text: file }];
    let entry;
    if (kind === "custom") entry = { type: "custom", id: "custom", parentId: null, timestamp: "2026-01-01T00:00:00Z", customType: "third-party-metadata", data: { file } };
    else if (kind === "literal") entry = message("entry", null, "assistant", [{ type: "toolCall", id: "call", name: "read", arguments: { path: file + "#different-literal-file" } }]);
    else if (kind === "intentional") entry = message("entry", null, "assistant", [{ type: "text", text: `[External reference safe fixture](${file}#L2)` }]);
    else {
      entry = message("entry", null, kind === "system" ? "system" : "toolResult", text);
      if (kind === "tool") Object.assign(entry.message, { toolName: "remote_search", toolCallId: "remote", isError: false });
    }
    writeSession(id, [entry]);
    return { kind, id, file };
  });
  return fixtures;
}

export async function checkExternalReferenceBoundary(page, base, fixtures) {
  const url = ({ file, id }, type = "read", includeSession = true) => `${base}/api/files/${file.split("/").filter(Boolean).map(encodeURIComponent).join("/")}?type=${type}${includeSession ? `&sessionId=${id}` : ""}`;
  for (const fixture of fixtures) {
    const baseline = await fetch(url(fixture, "read", false));
    assert.equal(baseline.status, 403, "fixture must really be outside every admitted root");
    await baseline.arrayBuffer();
    if (fixture.kind === "intentional") continue;
    for (const type of ["read", "download", "meta", "preview", "watch"]) {
      const response = await fetch(url(fixture, type), { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 403, `${fixture.kind} must not grant ${type}`);
      await response.arrayBuffer();
    }
  }
  const intentional = fixtures.find((fixture) => fixture.kind === "intentional");
  const read = await fetch(url(intentional));
  assert.equal(read.status, 200);
  assert.match((await read.json()).content, /SAFE_REFERENCE_SENTINEL/);
  for (const type of ["list", "edit"]) {
    const refused = await fetch(url(intentional, type));
    assert.equal(refused.status, 403);
    await refused.arrayBuffer();
  }
  await page.goto(`${base}/?session=${intentional.id}`, { waitUntil: "domcontentloaded" });
  const link = page.getByRole("link", { name: "External reference safe fixture", exact: true });
  await link.waitFor();
  assert.equal(await link.getAttribute("href"), intentional.file + "#L2");
  // This regression owns authorization and link rendering. Opening the viewer
  // also runs its existing edit/Git capability probes, which legitimately refuse
  // outside-root files. Do not suppress those unrelated browser console errors
  // or claim this API proof is an interactive external-viewer acceptance test.
  console.log(`PASS: ${page.viewportSize().width}px real external-reference denials, intentional HTTP read and rendered source link`);
}
