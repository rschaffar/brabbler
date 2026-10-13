# Dependency maintenance

Root and demo have independent manifests and lockfiles. Refresh both deliberately;
compare resolved versions, not just manifest ranges. Preserve the Pi SDK package
pins and native PTY pin unless their contracts have been evaluated separately.
Lockfile changes also require updating `nix/npm-deps.nix` and preparing matching
Nix-managed dependencies; never bypass the checkout dependency marker.

## Mermaid migration

Root/demo resolve Mermaid **12.2.0**. Its Node >=22.12 requirement fits the
application's existing >=22.19 requirement. The existing initialize/parse/render
adapter required no API changes; desktop/mobile browser coverage exercises math,
themes, source/preview, zoom, SVG exports, polling and live diagram updates.
This does not certify every Mermaid diagram grammar or optional layout engine.

## KaTeX compatibility exception

Both manifests pin KaTeX **0.19.0** and use `"katex": "$katex"` in `overrides`.
This deliberately applies the security-fixed renderer to rehype-katex and Mermaid
as well as the direct CSS/font dependency. Updating only the direct package leaves
vulnerable nested copies. The conditional inherited-trust vulnerability
[GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7)
is fixed from 0.18.2; it requires pre-existing prototype pollution.

This is **outside the adapters' declared upstream ranges**: rehype-katex 7.0.1
requests `^0.16.0`, and Mermaid 12.2.0 requests `^0.18.0`. It is a narrowly tested local
compatibility exception, not upstream support or proof that all formulas work.
Keep the exact pin until adapter releases support a fixed renderer, then remove
the override after verifying every resolved copy and CSS alignment again.

`lib/math-dependency.test.mjs` guards the root lockfile's resolved copies,
renderer/CSS version identity, inherited-trust rejection and public rendering API.
MarkdownBody/minimap tests exercise the rehype path. The browser file-preview
fixture adds inline/display/malformed/untrusted math, Mermaid math labels,
light/dark rendering, valid SVG downloads and state-preserving polling. Preserve
raw-HTML sanitization before math rendering and Mermaid `securityLevel: "strict"`.

Focused iteration:

```sh
nix develop .#test -c node nix/test-offline.mjs --file lib/math-dependency.test.mjs --file components/MarkdownBody.test.mjs --file components/ChatMinimap.test.mjs --file components/MermaidBlock.test.mjs
nix develop .#test -c env E2E_MARKDOWN_ONLY=1 npm run test:e2e
```

These are not complete acceptance. Follow [Testing](testing.md) for the final
baseline and separate browser/terminal/plugin coverage.
