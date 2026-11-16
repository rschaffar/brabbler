import assert from "node:assert/strict";
import { checkBlockingCard } from "./blocking-card.mjs";

// Real installed CSS/layout, not policy or draft recovery. Temporary appearance
// inputs stay document-local and are restored even when an assertion fails.
export async function checkQuestionCardDesign(card, { batch, mobile }) {
  const page = card.page();
  const viewport = page.viewportSize();
  const previous = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    dark: document.documentElement.classList.contains("dark"),
    size: document.documentElement.style.getPropertyValue("--chat-content-font-size"),
    priority: document.documentElement.style.getPropertyPriority("--chat-content-font-size"),
  }));
  try {
    for (const width of mobile ? [viewport.width, 320] : [viewport.width]) for (const theme of ["light", "dark"]) for (const offset of [0, 4]) {
      await page.setViewportSize({ ...viewport, width });
      await page.evaluate(({ theme, offset }) => {
        const root = document.documentElement;
        root.dataset.theme = theme;
        root.classList.toggle("dark", theme === "dark");
        root.style.setProperty("--chat-content-font-size", `${14 + offset}px`);
      }, { theme, offset });
      const sizes = await card.evaluate((root, { batch }) => {
        const question = root.querySelector(batch ? ".question-card-question" : ".blocking-card-title");
        const context = root.querySelector(".question-card-context .markdown-body");
        const title = root.querySelector(".question-card-option-title");
        const description = root.querySelector(".question-card-description .markdown-body");
        const field = root.querySelector("textarea");
        const size = node => parseFloat(getComputedStyle(node).fontSize);
        const background = root.querySelector(".question-card-background");
        const specific = root.querySelector(".question-card-specific");
        const nav = root.querySelector("nav");
        const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        const body = root.querySelector(".blocking-card-body");
        const footer = root.querySelector("footer");
        const footerBounds = footer.getBoundingClientRect();
        return {
          question: size(question), weight: getComputedStyle(question).fontWeight,
          context: size(context), title: size(title), description: size(description),
          headings: [...root.querySelectorAll(".markdown-body :is(h1,h2,h3,h4,h5,h6)")].map(size),
          descriptionHeadings: [...root.querySelectorAll(".question-card-description :is(h1,h2,h3,h4,h5,h6)")].map(size),
          helper: size(root.querySelector("summary")), field: size(field),
          select: batch ? size(root.querySelector("select")) : null,
          controls: [...root.querySelectorAll("textarea,select")].map(node => getComputedStyle(node).borderTopColor),
          expectedBorder: (() => {
            // Resolve the theme-derived color independently of the field rule.
            const probe = document.createElement("span");
            probe.style.color = "color-mix(in srgb, var(--text) 55%, var(--bg-panel))";
            root.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color;
          })(),
          order: !batch || (follows(background, nav) && follows(nav, question) && follows(question, specific)),
          expanded: [...root.querySelectorAll("details")].every(node => node.open),
          selected: root.querySelectorAll("input:checked").length,
          overflow: body.scrollWidth > body.clientWidth + 1,
          footerVisible: [...footer.querySelectorAll("button")].every(node => {
            const bounds = node.getBoundingClientRect();
            return bounds.left >= footerBounds.left && bounds.right <= footerBounds.right + 1 && bounds.top >= footerBounds.top && bounds.bottom <= footerBounds.bottom + 1;
          }),
        };
      }, { batch });
      const label = `${batch ? "set" : "legacy"}/${width}px/${theme}/offset${offset}`;
      assert.deepEqual([sizes.question, sizes.context, sizes.title, sizes.description], [18 + offset, 14 + offset, 14 + offset, 13 + offset], `${label}: question/body/option/description hierarchy`);
      assert.equal(sizes.weight, "600", `${label}: semibold question`);
      assert.equal(sizes.helper, 12, `${label}: helper size`);
      assert.equal(sizes.field, Math.max(mobile ? 16 : 0, 14 + offset), `${label}: editable text`);
      if (batch) assert.equal(sizes.select, Math.max(mobile ? 16 : 0, 14 + offset), `${label}: selector text`);
      assert.ok(sizes.headings.every(size => size <= 14 + offset), `${label}: Markdown headings remain subordinate`);
      if (batch) {
        assert.ok(sizes.headings.length >= 3, "exercise real shared/specific/description Markdown headings");
        assert.deepEqual(sizes.descriptionHeadings, [13 + offset]);
      }
      assert.ok(sizes.controls.every(color => color === sizes.expectedBorder), `${label}: stronger theme-derived editable borders`);
      assert.equal(sizes.order, true, `${label}: shared context precedes navigation; specific context follows question`);
      assert.equal(sizes.expanded, true, `${label}: contexts start expanded`);
      assert.equal(sizes.selected, 0, `${label}: no default selection`);
      assert.equal(sizes.overflow, false, `${label}: no horizontal body overflow`);
      assert.equal(sizes.footerVisible, true, `${label}: actions fit footer`);
      await checkBlockingCard(card);
    }
  } finally {
    await page.setViewportSize(viewport);
    await page.evaluate(previous => {
      const root = document.documentElement;
      if (previous.theme === null) root.removeAttribute("data-theme"); else root.setAttribute("data-theme", previous.theme);
      root.classList.toggle("dark", previous.dark);
      if (previous.size) root.style.setProperty("--chat-content-font-size", previous.size, previous.priority);
      else root.style.removeProperty("--chat-content-font-size");
    }, previous);
  }
}

export async function checkQuestionReviewDesign(card) {
  const styles = await card.evaluate(root => {
    const question = root.querySelector("h4.question-card-question");
    const answer = root.querySelector(".question-card-answer");
    const description = root.querySelector(".question-card-description");
    const size = node => parseFloat(getComputedStyle(node).fontSize);
    const probe = document.createElement("span");
    probe.style.color = "var(--text-muted)";
    root.append(probe); const muted = getComputedStyle(probe).color; probe.remove();
    return { question: size(question), answer: size(answer), description: size(description), color: getComputedStyle(description).color, muted };
  });
  assert.equal(styles.question - styles.answer, 4, "review question retains question/body hierarchy");
  assert.equal(styles.question - styles.description, 5, "review descriptions stay subordinate");
  assert.equal(styles.color, styles.muted, "review descriptions retain muted theme color");
}
