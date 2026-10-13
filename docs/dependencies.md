# Dependency maintenance

Root and demo have independent manifests and lockfiles. Refresh both deliberately;
compare resolved versions, not just manifest ranges. Preserve the Pi SDK package
pins and native PTY pin unless their contracts have been evaluated separately.
Lockfile changes also require updating `nix/npm-deps.nix` and preparing matching
Nix-managed dependencies; never bypass the checkout dependency marker.

## Runtime classification and locking

The root manifest declares the 12 shipped renderer/preview libraries as runtime
`dependencies`: ansi_up, katex, mammoth, mermaid, react-markdown,
react-syntax-highlighter, rehype-katex, rehype-raw, rehype-sanitize,
remark-frontmatter, remark-gfm and remark-math. Demo already classified its shared
renderers this way. Types, compiler/lint tooling, CSS build tooling and Playwright
remain development-only. Moving classification preserves resolved versions but
adds these packages and their transitives to downstream production npm installs.
Nix retains development modules (`dontNpmPrune`), so this is not a packaging or
launcher redesign. Release-time artifact checks still apply.

Keep proper-lockfile **4.1.2** despite its low release frequency. Account/auth,
preferences, activity, project trust and plugin settings rely on its async/sync,
retry and stale-lock semantics. Credential writes share the SDK's auth-file lock
protocol; the SDK uses the same package/version. Release age alone does not
justify a replacement. Any future replacement must prove cross-process and SDK
interoperability, including the existing stale-delete/concurrent-login regression.

## Deferred compiler/linter majors

**Retraction of the immediate ESLint 10 recommendation:** Next 16.4's current
import, React and accessibility plugins reject ESLint 10 in their declared peer
ranges (eslint-plugin-import 2.32.0, eslint-plugin-react 7.37.5 and
eslint-plugin-jsx-a11y 6.10.2). Retain ESLint 9.39.5 as compatibility debt, not a
claim that the unsupported major has become supported. Revisit when the complete
Next plugin graph supports 10; do not use legacy-peer-deps or disable lint rules.
Next's newer React Hooks checks remain enabled, with affected root/demo hooks
adapted rather than suppressed.

**Defer TypeScript 7:** typescript-eslint 8.71.2 declares TypeScript
`>=4.8.4 <6.1.0`, excluding 7. Keep TypeScript 5.9.3 until parser/plugin support
and a separate Next/compiler migration can be tested. Align Node types to Node
22, the supported runtime; js-yaml 5 supplies its own types, so external YAML
typings are unnecessary.

## Advisory disposition (2026-10-13)

A fresh npm bulk-advisory query against every resolved root/demo version found
**two root records across two packages**, and **one demo record**. The earlier
Next, js-yaml, KaTeX, DOMPurify, sharp, source-map-js and brace-expansion matches
are absent from these candidate lockfiles. This is advisory matching, not a
complete security audit or proof of absence of vulnerabilities.

| Remaining package | Scope | Disposition |
| --- | --- | --- |
| braces 3.0.3, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), high | Both locks; development-only micromatch path | Deeply nested glob patterns can exhaust the stack. Latest 3.0.3 remains affected (`<=3.0.3`); no fixed release was available. Keep as explicitly tracked tooling exposure; avoid treating untrusted patterns as safe. |
| sprintf-js 1.0.3, [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), moderate | Root; Mammoth's nested argparse dependency, runtime-classified | Unbounded format precision can cause DoS. Even latest 1.1.3 remains affected (`<=1.1.3`); changing the transitive range does not remediate it. No application-supplied formatter input was identified; package presence alone does not establish exploitability. |

This guide owns revisiting these two exposures and deferred majors on dependency
refreshes. Do not add blanket audit ignores or call this candidate audit-clean.
Nix input vulnerabilities and complete distributed-artifact review are separate.

## Redistribution licenses

Lockfile classification is not a license exemption. Root, Nix and demo artifacts
need notices based on what is actually redistributed, including bundled code.
Preserve MIT/ISC/BSD copyright/license texts and Apache licenses/applicable NOTICE
material. Notable expressions include Mammoth BSD-2-Clause, JSZip
`MIT OR GPL-3.0-or-later` (use MIT), DOMPurify `MPL-2.0 OR Apache-2.0` (use
Apache-2.0), and Pako `MIT AND Zlib` (both obligations).

Review source-availability obligations for MPL components (including web-push and
Lightning CSS) and LGPL source/relinking obligations for redistributed libvips.
Mermaid 12 introduces elkjs under **EPL-2.0**, requiring separate license/source
review if its optional layout engine is shipped. `images.unoptimized` and optional
feature use do not prove these components are absent from the shipped artifact.
Existing first-party/asset notices are not a dependency-wide notice inventory.
[Release](release.md) owns final artifact inspection; no full license-compliance
certification or production artifact review is implied by development acceptance.

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

`nix/check-math-dependencies.mjs` persistently guards both independent manifests
and lockfiles without installed modules. `lib/math-dependency.test.mjs` additionally
guards the root renderer/CSS identity, inherited-trust rejection and public API.
MarkdownBody/minimap tests exercise the rehype path. The browser file-preview
fixture adds inline/display/malformed/untrusted math, Mermaid math labels,
light/dark rendering, valid SVG downloads and state-preserving polling. Preserve
raw-HTML sanitization before math rendering and Mermaid `securityLevel: "strict"`.

Focused iteration:

```sh
node nix/check-math-dependencies.mjs
nix develop .#test -c node nix/test-offline.mjs --file lib/math-dependency.test.mjs --file components/MarkdownBody.test.mjs --file components/ChatMinimap.test.mjs --file components/MermaidBlock.test.mjs
nix develop .#test -c env E2E_MARKDOWN_ONLY=1 npm run test:e2e
```

These are not complete acceptance. Follow [Testing](testing.md) for the final
baseline and separate browser/terminal/plugin coverage.
