import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { fsCache: false });
const { getBrabblerReleaseUrl, isNewerStableVersion } = await jiti.import("./app-update.ts");

test("detects newer stable Brabbler versions", () => {
  assert.equal(isNewerStableVersion("0.8.8", "0.8.7"), true);
  assert.equal(isNewerStableVersion("0.9.0", "0.8.7"), true);
  assert.equal(isNewerStableVersion("1.0.0", "0.9.9"), true);
});

test("does not report equal, older, or unsupported versions as updates", () => {
  assert.equal(isNewerStableVersion("0.8.7", "0.8.7"), false);
  assert.equal(isNewerStableVersion("0.8.6", "0.8.7"), false);
  assert.equal(isNewerStableVersion("0.8.8-beta.1", "0.8.7"), false);
  assert.equal(isNewerStableVersion("invalid", "0.8.7"), false);
});

test("never invents a Brabbler publication URL or links upstream releases", () => {
  assert.equal(getBrabblerReleaseUrl("0.8.8"), null);
  assert.equal(getBrabblerReleaseUrl("0.8.8-beta.1"), null);
});

test("the unpublished fork's update route performs no registry/network request", async t => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("No update network access is allowed"); };
  t.after(() => { globalThis.fetch = original; });
  const { GET } = await jiti.import("../app/api/app-update/route.ts");
  const response = GET();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.updateAvailable, false);
  assert.equal(body.releaseUrl, "");
  assert.equal(body.latestVersion, body.currentVersion);
  assert.equal(calls, 0);
});
