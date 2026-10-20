import assert from "node:assert/strict";
import { createOwnedRoutes } from "./owned-routes.mjs";

/** A successful script response missing its chunk registration rejects the import
 * without manufacturing an HTTP/console exemption. The app must catch it. */
export async function checkHighlightFailure(page, base, fixture) {
  await page.goto(`${base}/?session=${fixture.sessionId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Typed source", exact: true }).waitFor();
  const panel = page.locator("#file-panel"), pane = panel.locator(".file-viewer-content");
  const open = async name => {
    const hide = panel.getByRole("button", { name: "Hide file panel", exact: true });
    if (await hide.count() && await hide.getAttribute("aria-expanded") === "true") await hide.click();
    await page.getByRole("link", { name, exact: true }).click();
  };
  const pattern = "**/_next/static/chunks/*.js";
  let requests = 0;
  const owned = createOwnedRoutes(async route => {
    requests++;
    await route.fulfill({ status: 200, contentType: "application/javascript", body: "window.__failedHighlightChunk = true;" });
  }, route => route.continue());
  const failures = [];
  await page.route(pattern, owned.handler);
  try {
    await open("Typed source");
    await page.waitForFunction(() => window.__failedHighlightChunk === true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const target = pane.locator('[data-line-number="180"]');
    assert.match(await target.textContent(), /Highlight sentinel/);
    assert.equal(await pane.locator(".token.attr-equals").count(), 0);
    assert.ok(requests > 0);
    await owned.dispose(handler => page.unroute(pattern, handler));
    await open("Plain source");
    await pane.getByText("Plain highlighting sentinel", { exact: true }).waitFor();
    await open("Typed source");
    await pane.locator(".token.attr-equals").first().waitFor();
    assert.equal(await target.getAttribute("data-file-line-target"), "true");
    console.log(`PASS: ${page.viewportSize().width}px failed grammar chunk leaves readable Source and later demand retries`);
  } catch (error) { failures.push(error); }
  finally {
    owned.beginDisposal();
    try { await owned.dispose(handler => page.unroute(pattern, handler)); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, "Highlight failure fixture failed");
  }
}
