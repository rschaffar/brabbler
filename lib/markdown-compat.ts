import type { Content, Link, Parent, Root } from "mdast";
import type { Element as HastElement, Root as HastRoot, RootContent as HastContent } from "hast";
import type { Plugin } from "unified";
import type { Extension } from "micromark-util-types";
import remarkMath from "remark-math";
import { defaultSchema } from "rehype-sanitize";
export const markdownClobberPrefix = defaultSchema.clobberPrefix ?? "user-content-";


interface MarkdownFragmentClick {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  currentTarget: Pick<Element, "getAttribute" | "closest">;
  preventDefault(): void;
}

/**
 * A click on a `#fragment` link in rendered Markdown: brings the element it
 * names into view within the same rendered document (the closest
 * `.markdown-body`), as the Skills reader does with its headings. The browser's
 * own jump searches the whole page, where every chat message with a footnote
 * has its own `user-content-user-content-fn-1` and the file preview sits beside
 * the chat, so it could land in another message; it would also put the
 * fragment in the app's URL as a history entry. Modified clicks stay the
 * browser's.
 */
export function jumpToMarkdownFragment(event: MarkdownFragmentClick): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const href = event.currentTarget.getAttribute("href");
  if (!href?.startsWith("#")) return;
  event.preventDefault();
  let id = href.slice(1);
  if (!id) return;
  try {
    id = decodeURIComponent(id);
  } catch {
    // A malformed escape is matched as written.
  }
  const name = CSS.escape(id);
  const heading = CSS.escape(id.startsWith(markdownClobberPrefix) ? id.slice(markdownClobberPrefix.length) : id);
  const root = event.currentTarget.closest(".markdown-body");
  // A selector list picks DOM order, not selector priority. Honor an explicit
  // raw/footnote destination before falling back to a generated heading slug.
  const target = root?.querySelector(`[id="${name}"], a[name="${name}"]`)
    ?? root?.querySelector(`[data-heading-anchor="${heading}"]`);
  target?.scrollIntoView({ block: "start" });
}


const cjkPunctuationPattern =
  /[\u3001\u3002\u3008-\u3011\u3014-\u301B\uFF01\uFF08\uFF09\uFF0C\uFF1A\uFF1B\uFF1F\u2018\u2019\u201C\u201D\u2013\u2014\u2026\u00B7\uFF5E\u301C]/;

/**
 * Split every GFM autolink literal at its first CJK punctuation mark, turning the
 * trailing prose back into a plain text node.
 *
 * `source` must be the markdown the tree was parsed from. An autolink literal's
 * raw source **is** its text, while a hand-written `[text](url)` link's raw source
 * is `[text](url)` — comparing the two is what leaves explicit links untouched
 * even when their text happens to equal their url.
 */
export function splitAutolinkLiteralsAtCjkPunctuation(tree: Root, source: string): void {
  const walk = (node: Root | Parent): void => {
    const children = node.children as Content[];
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      if (child.type === "link") splitAutolinkLiteral(children, index, child, source);
      const current = children[index];
      if ("children" in current && Array.isArray(current.children)) walk(current as Parent);
    }
  };
  walk(tree);
}

function splitAutolinkLiteral(
  siblings: Content[],
  index: number,
  node: Link,
  source: string,
): void {
  if (node.title != null || node.children.length !== 1) return;
  const textNode = node.children[0];
  if (textNode.type !== "text") return;

  const start = node.position?.start;
  const end = node.position?.end;
  if (start?.offset == null || end?.offset == null) return;
  if (source.slice(start.offset, end.offset) !== textNode.value) return;

  const text = textNode.value;
  const cut = text.search(cjkPunctuationPattern);
  // `cut === 0` means the literal itself starts with punctuation — not a URL.
  if (cut <= 0 || !node.url.endsWith(text)) return;

  const head = text.slice(0, cut);
  const boundary = { line: start.line, column: start.column + cut, offset: start.offset + cut };
  // The url carries a `http://` (www.) or `mailto:` prefix the text does not.
  node.url = node.url.slice(0, node.url.length - text.length) + head;
  textNode.value = head;
  node.position = { start, end: boundary };
  siblings.splice(index + 1, 0, {
    type: "text",
    value: text.slice(cut),
    position: { start: boundary, end },
  });
}

export function remarkSplitAutolinkLiterals() {
  return (tree: Root, file: { value?: unknown }): void => {
    splitAutolinkLiteralsAtCjkPunctuation(tree, typeof file.value === "string" ? file.value : "");
  };
}

// Reject ambiguous single-dollar pairs during tokenization, before math can
// swallow Markdown emphasis or links. A price's next dollar ("$20 ... $6")
// cannot close math, nor can the space before a later formula ("$20 and $x$").
// Keep the upstream tokenizer/resolver for real math, code, escapes and $$.
export const remarkCurrencySafeMath: Plugin = function () {
  remarkMath.call(this);
  const data = this.data() as { micromarkExtensions?: Extension[] };
  const extension = data.micromarkExtensions?.at(-1);
  const constructs = extension?.text?.[36];
  for (const construct of Array.isArray(constructs) ? constructs : constructs ? [constructs] : []) {
    if (construct.name !== "mathText") continue;
    const tokenize = construct.tokenize;
    construct.tokenize = function (effects, ok, nok) {
      const start = this.now();
      return tokenize.call(this, effects, (code) => {
        const source = this.sliceSerialize({ start, end: this.now() });
        if (source.startsWith("$") && !source.startsWith("$$")) {
          const content = source.slice(1, -1);
          const startsWithAmount = /^\s*[+-]?(?:\d|\.\d)/.test(content);
          const closesBeforeNumber = code !== null && code >= 48 && code <= 57;
          // Balanced padding ($ x + y $) remains supported, as does multiline
          // math. A one-sided space is prose, not an inline-math boundary.
          const mismatchedPadding = /^\s/.test(content) !== /\s$/.test(content);
          if (startsWithAmount && (closesBeforeNumber || mismatchedPadding)) return nok(code);
        }
        return ok(code);
      }, nok);
    };
  }
};


interface SanitizedNode {
  type?: string;
  properties?: Record<string, unknown>;
  children?: SanitizedNode[];
}

/**
 * GitHub rewrites both sides of a content anchor. cmark-gfm prefixes rendered
 * `id`s with `user-content-` (anti-clobber) and rewrites same-document fragment
 * links to match, so a hand-written pair like `<a id="toc"></a>` with
 * `[ToC](#toc)` still lands after rendering. `rehype-sanitize` copies only the
 * `id` half of that — `defaultSchema`'s `clobber` + `clobberPrefix` — which on
 * its own breaks every in-document anchor pair: the element gains the prefix
 * and the link pointing at it does not.
 *
 * This plugin runs after sanitizing and prefixes fragment links exactly as
 * unconditionally as sanitizing prefixes ids, so an id and an href that matched
 * before sanitizing still match afterwards. Footnote references need it for the
 * same reason: `mdast-util-to-hast` generates both their sides already prefixed
 * and sanitizing prefixes the id once more, so an unprefixed href would strand
 * the footnote link behind the doubled prefix.
 *
 * Links to page elements keep being unreachable from Markdown — that is the
 * clobber protection doing its job, not this plugin. A bare `#` has no fragment
 * to pair and stays as written.
 */
export function rehypeMatchClobberedIds(): (tree: unknown) => void {
  return (tree: unknown): void => {
    const visit = (node: SanitizedNode): void => {
      if (!node || typeof node !== "object") return;
      const href = node.properties?.href;
      if (node.type === "element" && typeof href === "string" && href.startsWith("#") && href.length > 1) {
        node.properties!.href = `#${markdownClobberPrefix}${href.slice(1)}`;
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree as SanitizedNode);
  };
}


function hastText(node: HastContent): string {
  return node.type === "text" ? node.value : node.type === "element" ? node.children.map(hastText).join("") : "";
}

/** GitHub's heading slugs for `#fragment` links, as a data attribute: two rendered documents never share an id. */
export function markdownHeadingAnchors() {
  return (tree: HastRoot) => {
    const seen = new Map<string, number>();
    const visit = (node: HastRoot | HastElement) => node.children.forEach((child) => {
      if (child.type !== "element") return;
      if (/^h[1-6]$/.test(child.tagName)) {
        const base = hastText(child).toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, "").replace(/ /g, "-");
        // As github-slugger numbers repeats: "a", "a", "a-1" become a, a-1, a-1-1.
        let slug = base;
        while (seen.has(slug)) {
          seen.set(base, seen.get(base)! + 1);
          slug = `${base}-${seen.get(base)}`;
        }
        seen.set(slug, 0);
        child.properties.dataHeadingAnchor = slug;
      }
      visit(child);
    });
    visit(tree);
  };
}

