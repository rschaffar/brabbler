import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { MermaidBlock, CodeBlock, downloadMermaidSvg } = await jiti.import("./MermaidBlock.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

// Simple sequenceDiagram for testing
const mermaidSrc = `sequenceDiagram
    Alice->>Bob: Hello
    Bob-->>Alice: Hi`;

function renderMermaid(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MermaidBlock, props),
    ),
  );
}

test("image-capable Mermaid metadata stays inert before opt-in, including YAML escaped keys", () => {
  for (const code of [
    'flowchart TD\n A@{ img: "https://tracking.invalid/pixel", label: "Image" }',
    'flowchart TD\n A@{ "img": "//tracking.invalid/pixel", label: "Image" }',
    String.raw`flowchart TD
 A@{ "\u0069mg": "https://tracking.invalid/pixel", label: "Image" }`,
    'flowchart TD\n A@{ shape: rect, label: "Conservatively blocked metadata" }',
    'flowchart TD\n A["<img src=\"https://tracking.invalid/pixel\">"]',
    'flowchart TD\n A["&lt;img src=...&gt;"]',
    'flowchart TD\n A["#60;img src=...#62;"]',
    '%%{init: {"htmlLabels": true}}%%\nflowchart TD\n A[Label]',
    '---\nconfig:\n  htmlLabels: true\n---\nflowchart TD\n A[Label]',
    'flowchart TD\n A["![Image](https://tracking.invalid/pixel)"]',
    'flowchart TD\n A[Label]\n style A fill:url(https://tracking.invalid/pixel)',
    String.raw`flowchart TD
 A[Label]
 classDef image fill:u\72l(https://tracking.invalid/pixel);`,

  ]) {
    const html = renderMermaid({ code, defaultPreview: true });
    assert.match(html, /Diagram resource-capable syntax blocked/);
    assert.match(html, /Enable remote images/);
    assert.doesNotMatch(html, /mermaid-block-loading|<img|<svg/);
  }
});

test("MermaidBlock renders source by default", () => {
  const html = renderMermaid({ code: mermaidSrc });

  assert.match(html, />Preview</);
  assert.match(html, /Alice/);
  assert.doesNotMatch(html, /mermaid-block-loading/);
});

test("MermaidBlock can render preview by default", () => {
  const html = renderMermaid({ code: mermaidSrc, defaultPreview: true });

  assert.match(html, />Source</);
  assert.match(html, /mermaid-block-loading/);
  assert.doesNotMatch(html, /Alice/);
});

test("MermaidBlock with isStreaming falls back to source view", () => {
  const html = renderMermaid({ code: mermaidSrc, isStreaming: true, defaultPreview: true });

  assert.match(html, /disabled/);
  assert.match(html, />Preview</);
  assert.match(html, /Alice/);
  assert.match(html, /-&gt;&gt;/);
});

test("MermaidBlock renders empty graph without error", () => {
  const html = renderMermaid({ code: "graph TD", defaultPreview: true });

  assert.doesNotMatch(html, /mermaid-block-error/);
  assert.match(html, /mermaid-block-loading/);
});

function renderCode(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(CodeBlock, props),
    ),
  );
}

test("CodeBlock initially renders escaped plain code, even after grammars loaded on the server", async () => {
  const props = { code: 'const x = "<script>sentinel</script>";', lang: "javascript" };
  const cold = renderCode(props);
  const { loadPrismLanguages } = await jiti.import("@/lib/prism-languages");
  await loadPrismLanguages();
  const warm = renderCode(props);
  assert.equal(warm, cold, "initial hydration cannot depend on process-wide grammar readiness");
  assert.doesNotMatch(warm, /class="token|<script>/);
  assert.match(warm, /&lt;script&gt;sentinel&lt;\/script&gt;/);
  assert.match(warm, /react-syntax-highlighter-line-number/);
});

test("CodeBlock renders plain text without tokenization while streaming", () => {
  const html = renderCode({ code: "const x = 1;", lang: "javascript", isStreaming: true });

  assert.doesNotMatch(html, /class="token/);
  assert.match(html, /const x = 1;/);
});

test("MermaidBlock handles Chinese characters in diagram", () => {
  const chineseMermaid = `sequenceDiagram
    participant PC as PC客户端
    PC->>SV: 请求登录`;

  const html = renderMermaid({ code: chineseMermaid, defaultPreview: true });

  assert.doesNotMatch(html, /mermaid-block-error/);
  assert.match(html, /mermaid-block/);
});

test("downloadMermaidSvg downloads XML-serialized SVG and releases its URL", async () => {
  const originalDocument = globalThis.document;
  const originalXMLSerializer = globalThis.XMLSerializer;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const svgElement = { nodeName: "svg" };
  const serializedSvg = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">first<br />second</div></foreignObject></svg>';
  const link = { href: "", download: "", clicked: false, click() { this.clicked = true; } };
  let downloadedBlob;
  globalThis.document = { createElement: () => link };
  globalThis.XMLSerializer = class {
    serializeToString(element) {
      assert.equal(element, svgElement);
      return serializedSvg;
    }
  };
  URL.createObjectURL = (blob) => {
    assert.equal(blob.type, "image/svg+xml;charset=utf-8");
    downloadedBlob = blob;
    return "blob:mermaid";
  };
  let revoked = null;
  URL.revokeObjectURL = (url) => { revoked = url; };

  try {
    downloadMermaidSvg(svgElement);
    assert.equal(await downloadedBlob.text(), serializedSvg);
    assert.equal(link.href, "blob:mermaid");
    assert.equal(link.download, "mermaid-diagram.svg");
    assert.equal(link.clicked, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(revoked, "blob:mermaid");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalXMLSerializer === undefined) delete globalThis.XMLSerializer;
    else globalThis.XMLSerializer = originalXMLSerializer;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});
