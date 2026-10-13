import type { Element, Root } from "hast";

const BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "table", "tr", "hr", "div"]);

/** Run after raw HTML sanitization: only parser-owned positions become navigation metadata. */
export function rehypeMarkdownSourceLines({ sourceLines }: { sourceLines: number[] }) {
  return (tree: Root) => {
    const visit = (node: Root | Element) => {
      if (node.type === "element") {
        delete node.properties.dataSourceLineStart;
        delete node.properties.dataSourceLineEnd;
        if (BLOCKS.has(node.tagName) && node.position) {
          const start = sourceLines[node.position.start.line - 1];
          const end = sourceLines[node.position.end.line - 1];
          if (start && end) {
            node.properties.dataSourceLineStart = start;
            node.properties.dataSourceLineEnd = end;
          }
        }
      }
      node.children = node.children.map((child) => {
        if (child.type !== "element") return child;
        visit(child);
        const code = child.children[0];
        if (child.tagName === "pre" && code?.type === "element" && Array.isArray(code.properties.className)
          && (code.properties.className.includes("math-display") || code.properties.className.includes("language-math"))) {
          // KaTeX replaces its pre ancestor; keep the coordinates on a surviving wrapper.
          return { type: "element", tagName: "div", properties: {
            dataSourceLineStart: child.properties.dataSourceLineStart,
            dataSourceLineEnd: child.properties.dataSourceLineEnd,
          }, children: [child] } satisfies Element;
        }
        return child;
      });
    };
    visit(tree);
  };
}
