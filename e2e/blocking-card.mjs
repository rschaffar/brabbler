import assert from "node:assert/strict";

/** Observe automatic arrival without Playwright scrolling the card or its actions. */
export async function checkBlockingCardArrival(card) {
  await card.page().waitForFunction((element) => {
    const scroller = element.closest(".overflow-y-auto");
    const footer = element.querySelector(".blocking-card-footer");
    if (!scroller || !footer) return false;
    const viewport = scroller.getBoundingClientRect();
    const actions = footer.getBoundingClientRect();
    return actions.height > 0 && actions.top >= viewport.top && actions.bottom <= viewport.bottom + 1;
  }, await card.elementHandle());
}

/** Long bodies scroll without moving header/actions or overflowing the viewport. */
export async function checkBlockingCard(card) {
  await card.scrollIntoViewIfNeeded();
  const layout = await card.evaluate((element) => {
    const body = element.querySelector(".blocking-card-body");
    const header = element.querySelector(".blocking-card-header");
    const footer = element.querySelector(".blocking-card-footer");
    const bounds = element.getBoundingClientRect();
    const before = footer.getBoundingClientRect().top;
    const original = body.scrollTop;
    body.scrollTop = body.scrollHeight;
    const after = footer.getBoundingClientRect().top;
    body.scrollTop = original;
    return { height: bounds.height, viewportHeight: innerHeight, right: bounds.right, viewportWidth: innerWidth,
      headerInside: header.getBoundingClientRect().top >= bounds.top,
      footerInside: footer.getBoundingClientRect().bottom <= bounds.bottom + 1, before, after };
  });
  assert.ok(layout.height <= layout.viewportHeight * .65 + 2, "Card height is bounded");
  assert.ok(layout.right <= layout.viewportWidth + 1, "Card does not expand the viewport");
  assert.ok(layout.headerInside && layout.footerInside, "Header and footer stay inside the card");
  assert.equal(layout.before, layout.after, "Scrolling the body leaves actions in place");
}
