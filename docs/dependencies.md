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

## Pi SDK 1.2.0 catalog compatibility

The Pi package pins remain exact. SDK 1.2.0 personalizes OpenRouter catalogs via
`/models/user` and persists the resulting model list, limits and prices. Additional
accounts must therefore bind both credentials and a catalog store to the same
immutable complete account-ID snapshot, never reuse or seed from the Pi-default
store. `lib/account-model-runtime.ts` owns this boundary; ordinary Pi-default
routes retain CLI-compatible storage. See [Model/account contracts](model-internals.md).

Focused regressions extend `lib/provider-accounts.test.mjs` and
`lib/model-catalog-refresh*.test.mjs`: synthetic disk-backed A/B/default catalogs,
offline reopening, pending-login ownership, refresh joining/serialization and
metadata-only invalidation. All catalog HTTP is stubbed; these tests do not replace
parent-owned static, session, browser, terminal or plugin acceptance on SDK upgrades.

## Lint compatibility and deferred compiler major

**Earlier ESLint 10 hold withdrawn after verification:** root and demo resolve
ESLint **10.12.0** with the unchanged Next **16.4.0** presets. The earlier hold
treated plugin peer-range exclusions as a runtime blocker; that conclusion was
too strong. Next documents ESLint 10 compatibility and supplies compatibility
adapters. Normal npm installation and clean `npm ci` reproduce the lint toolchain
without force or legacy-peer-deps flags, changed peer declarations, overrides for
ESLint, or disabled rules.

This remains a **plugin peer-support exception**: eslint-plugin-import 2.32.0,
eslint-plugin-react 7.37.5 and eslint-plugin-jsx-a11y 6.10.2 exclude ESLint 10 from
their published peer ranges, so npm emits peer warnings. Next's compatibility
support and local verification do not change those upstream declarations or
certify every rule. Revisit the exception when the plugins publish native support;
do not suppress warnings or replace the preset solely to remove metadata lag.
Existing React Hooks rule settings are unchanged by this upgrade.

`lib/eslint-compatibility.test.mjs` exercises the actual selected project config,
not a reduced test preset: invalid accessibility attributes, missing image text,
React keys and conditional Hooks, anonymous exports, explicit TypeScript `any`,
Next image checks, and a clean typed-JSX control. The root offline suite discovers
it automatically. Run it independently against the demo's installed dependencies
from `demo/` with `node --test ../lib/eslint-compatibility.test.mjs`. Both projects
retain their original file selection and enabled rule options in the migration
comparison. See [Next's ESLint guide](https://nextjs.org/docs/app/api-reference/config/eslint).

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
nix run .#test -- core --file lib/math-dependency.test.mjs --file components/MarkdownBody.test.mjs --file components/ChatMinimap.test.mjs --file components/MermaidBlock.test.mjs
nix run .#test -- e2e --group markdown
```

These are not complete acceptance. Follow [Testing](testing.md) for the final
complete sandboxed core/plugin and packaged-service VM baseline.
