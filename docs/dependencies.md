# Dependency maintenance

Root and demo have independent manifests and lockfiles. Refresh both deliberately;
compare resolved versions, not just manifest ranges. Preserve the Pi SDK package
pins and native PTY pin unless their contracts have been evaluated separately.
Lockfile changes also require updating `nix/npm-deps.nix`. Nix realizes matching
built dependencies automatically for packages and acceptance. Writable manual-development
shells still enforce their checkout dependency marker; never bypass it.

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

## Pi SDK 1.3.0 compatibility

The four direct Pi package pins are now exactly **1.3.0**; the coordinated
MCP, codemode and telemetry packages also resolve **1.3.0**, with no older SDK
copies. Normal npm resolution with strict engine checks required no force flags,
new overrides or peer edits. No external package resolution changed. Demo has no
Pi dependency; its independent manifests/lock and the Nix toolchain inputs remain
unchanged in that SDK-only upgrade. Node 22 and TypeScript 5 were preserved at
that checkpoint; the subsequently approved runtime/compiler migration is recorded
below. Native PTY, proper-lockfile and KaTeX choices remain unchanged.

SDK 1.2.0 introduced personalized OpenRouter catalogs via `/models/user` and
persisted model lists, limits and prices. Additional accounts continue to require
both credentials and a catalog store bound to the same
immutable complete account-ID snapshot, never reuse or seed from the Pi-default
store. `lib/account-model-runtime.ts` owns this boundary; ordinary Pi-default
routes retain CLI-compatible storage. See [Model/account contracts](model-internals.md).

Focused regressions extend `lib/provider-accounts.test.mjs` and
`lib/model-catalog-refresh*.test.mjs`: synthetic disk-backed A/B/default catalogs,
offline reopening, pending-login ownership, refresh joining/serialization and
metadata-only invalidation. All catalog HTTP is stubbed; these tests do not replace
parent-owned static, session, browser, terminal or plugin acceptance on SDK upgrades.

The 1.3 review found no required application API migration. Account/catalog,
preflight/disposal, resource discovery and native Codex tier-pricing implementations
remain compatible; keep the guarded launch lifecycle and reported-`fast` pricing
shim rather than removing them on a version-number assumption. All seven packages
retain Node **>=22.19.0**, MIT licensing and their external dependency declarations;
coordinated internal Pi edges are now exact **1.3.0** instead of `^1.2.0`.

Notable upstream behavior changes:

- Resumed default-tool sessions restore their transcript tool loadout. Explicit
  persisted Pi Web tool selections and Chat-only restrictions still take precedence.
- Ambiguous model scopes can include multiple providers with warnings; Pi Web's
  stricter exact-ambiguity rejection remains intentional. The settings editor
  reflects both SDK matches for repair; disabling one writes an explicit surviving
  reference with its thinking pin intact. The migration regression checks both
  owners, ambiguous-start refusal, exact repair and the last-model guard.
- Malformed complete tool arguments carry `argumentsError` and are refused before
  execution instead of executing a partially parsed prefix. Cross-model reasoning
  is omitted from outgoing provider context; saved history is not rewritten.
- Codemode admits at most **two live workers across sessions per SDK module
  instance**, counting cancelled workers until actual exit. Capacity fails promptly;
  cancellation acknowledgement is not worker-settlement proof.
- Kimi Coding now uses OpenAI Chat Completions with a default endpoint ending in
  `/coding/v1`; custom base-URL overrides must include `/v1`. OpenCode's bundled
  endpoints move from `/zen` to `/inference`. No local settings or credentials are
  inspected or rewritten by the upgrade.

A fresh root advisory match after the SDK update still returns only the two
braces/sprintf-js records below, with no Pi-package match. This is not live-provider,
exploitability or complete artifact-license certification. Existing context tests
cover change detection but not an independently asserted complete discovery-order
plus Chat-only provider request; wire/SSE tests do not join a real partial tool
stream and reconnect in one regression. These remain bounded coverage opportunities,
not observed SDK failures or reasons to weaken the existing acceptance baseline.

## Compatible maintenance pass (2026-10-16)

Root/demo resolve coordinated Next and eslint-config-next **16.4.2**, React and
react-dom **19.3.1**, and js-yaml **5.5.0**. Root additionally resolves Undici
**8.12.2** and Playwright **1.64.1**. Ordinary selective npm updates refresh the
allowed transitive graph, including Shiki **4.5.0**, Zod **4.6.7** and JSZip
**3.10.2**, without force/legacy-peer-deps flags or new overrides. Selection
excluded the SDK family: published caret ranges would otherwise admit SDK 1.3
transitives despite the four direct 1.2.0 pins. Its seven-package **1.2.0** hold
was subsequently superseded by the separately authorized coordinated **1.3.0**
upgrade described above.

Next 16.4.2 includes the 16.4.1 security fixes and further bundler fixes; React
and Undici updates include transport/security hardening. The YAML update also
rejects invalid unquoted punctuation-leading scalars and advances its argparse
dependency. These are normal package changes, not proof of complete security.
No application API migration or lint-rule suppression is intended by this pass.

Nix inputs stay on their existing tracks: nixpkgs advances to
`55bfb4d7437bd4e09ab7cba58a43bd68eb310044`, Home Manager to
`640725978b99076e18e069f6e7d2959124584f8f`. Node remains **22.23.3**; Chromium
advances within 155 from **155.0.8059.39** to **155.0.8059.79**, including published
security fixes. Home Manager's stricter `useGlobalPkgs` validation does not require
a change to this project's VM/service configuration; `home.stateVersion` is not
raised. Updating this project lock does not update any installed host Nix daemon
or activate a host service. Chromium 155 remains an executable override rather
than Playwright's bundled Chromium 156; complete packaged VM acceptance owns
compatibility, not a matching-major assumption. Upstream Chromium already has
further fixes beyond this Nix channel's package.

### Remaining version choices

At the registry checkpoint, **36/43 root** and **25/27 demo** direct dependencies
matched npm's latest tag before the separate SDK upgrade. The four root Pi SDK
holds (1.2.0 versus 1.3.0) are now resolved. Remaining deliberate choices are
native PTY's tested 1.2.0-beta.15 rather than a downgrade to stable 1.1.0, Node 24
typings rather than Node 26, and TypeScript 6 rather than 7. Keep proper-lockfile
4.1.2 and the tested KaTeX exception described below. Older transitives constrained
by parents or major ranges are not an
instruction to add overrides or replace working libraries. Later registry
releases require another inventory, not a perpetual-currentness claim.

## Node 24 and TypeScript 6 baseline

Following isolated evaluation and explicit user approval, the Nix development,
update, package, core/fresh-runner and VM fixture toolchains use **Node 24.21.0**
from the unchanged pinned nixpkgs revision. The package and native modules share
that runtime, including a fresh node-pty rebuild. Core's fail-closed runtime-major
check now requires **24**, not a permissive 22-or-24 fallback. The launcher and
root/demo manifests require **Node >=24.0.0**; demo CI selects **24.21.0**. This
intentionally ends the app's advertised Node 22 baseline rather than pairing Node
24 typings with a promise of Node 22 support. Actual complete acceptance targets
the pinned Linux runtime, not every newer version accepted by the minimum check.

Root/demo resolve **@types/node 24.19.2**, **TypeScript 6.0.3** and its Node-typing
support dependency **undici-types 7.24.6**. No runtime library resolution, SDK/native
PTY/locking/math pin, ESLint rule or TypeScript configuration is changed. Nix input
revisions and Home Manager state version remain fixed. Ordinary engine-strict npm
resolution needs no force/legacy-peer-deps flags or changed peer declarations.

The Node-only trial preserved TypeScript 5/Node 22 typings; its static checks and
28 selected SDK/runtime cases passed. The independent compiler-only trial preserved
Node 22/its typings and passed root typegen/typecheck/lint plus eight real-config
lint probes; its separate demo install, asset preparation, static checks and ten
regressions passed with the existing unused-locale warning. These are focused
experiments, not complete acceptance of the combined adopted candidate. Current
commands and complete acceptance remain owned by [Testing](testing.md).

## Lint compatibility and deferred compiler major

**Earlier ESLint 10 hold withdrawn after verification:** root and demo resolve
ESLint **10.12.0** with Next **16.4.2** presets; existing lint configuration and
rule settings are unchanged. The earlier hold
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
Next image checks, and a clean typed-JSX control. The root sandboxed Nix core suite
discovers it automatically. A focused root run is
`nix run .#test -- core --file lib/eslint-compatibility.test.mjs`.
Run it independently against the demo's installed dependencies from `demo/` with
`node --test ../lib/eslint-compatibility.test.mjs`; that separate demo-maintenance
probe is not an alternative application-acceptance path. Both projects retain
their original file selection and enabled rule options in the migration comparison.
See [Next's ESLint guide](https://nextjs.org/docs/app/api-reference/config/eslint).

**TypeScript 5 hold withdrawn; TypeScript 7 remains deferred:** typescript-eslint
8.71.2 declares TypeScript `>=4.8.4 <6.1.0`, which includes the adopted **6.0.3**
but excludes 7. Root/demo compatibility trials required no source changes, compiler
suppression or lint-rule changes. TypeScript 7 still needs a separate migration
assessment, not a declaration that it necessarily fails. Node types now follow the
selected **Node 24** runtime; js-yaml 5 supplies its own types, so external YAML
typings are unnecessary.

## Advisory disposition (2026-10-16)

After the compatible update pass, a fresh public npm bulk-advisory query against
every resolved root/demo version still found **two root records across two
packages**, and **one demo record**. The earlier Next, js-yaml, KaTeX, DOMPurify,
sharp, source-map-js and brace-expansion matches are absent from these candidate
lockfiles. This is advisory matching, not a
complete security audit or proof of absence of vulnerabilities.

| Remaining package | Scope | Disposition |
| --- | --- | --- |
| braces 3.0.3, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), high | Both locks; development-only micromatch path, physically retained by Nix | Deeply nested attacker-controlled pattern strings can exhaust recursive AST walkers. Latest 3.0.3 remains affected (`<=3.0.3`), with no fixed release identified. Current Next lint configs omit the `settings.next.rootDir` setting that invokes this glob path. Retain the advisory; this is not a patched parser or a general untrusted-pattern safety claim. |
| sprintf-js 1.0.3, [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), moderate | Root; Mammoth's nested argparse dependency, runtime-classified and physically present | Attacker-controlled format strings can supply unchecked numeric precision, causing `RangeError` and potentially aborting an uncaught operation. Latest 1.1.3 remains affected (`<=1.1.3`). Mammoth's conversion library does not load its CLI argparse/formatter branch; no preview-to-format-string path was found. Retain the advisory rather than calling the package fixed or audit-clean. |

The braces path in both locks is `eslint-config-next → @next/eslint-plugin-next
→ fast-glob → micromatch → braces`; upgrading the Next preset did not remove it.
The sprintf-js path is `mammoth → argparse → sprintf-js`. Neither library is a
direct application dependency. Development-only classification does not establish
absence from Nix's dependency output, which deliberately retains dev modules.
### Version-scoped reachability review (2026-10-16)

The actual root chain is Mammoth **1.13.0 → nested argparse 1.0.10 → sprintf-js
1.0.3**. The separate root argparse **3.0.3** used by js-yaml has no sprintf-js
dependency. Mammoth's Node `lib/index.js` conversion entry does not load argparse
or sprintf-js; only its separate `bin/mammoth` CLI imports the parser. The app's
single Mammoth import in `app/api/files/[...path]/route.ts` invokes `convertToHtml`
with a selected file and fixed image/external-access options, never CLI arguments
or a formatter template. Document text, filenames and embedded Mammoth style maps
are converter/parser inputs, not sprintf format parameters. Percent characters
inside substituted values are not recursively interpreted as format strings.

A bounded child-process probe converted two tiny stored-ZIP DOCX inputs, including
a successfully applied embedded style map, while interception refused any argparse
or sprintf-js load. Neither branch was requested during conversion. Separate
positive interception controls refused both modules before executing them. No
vulnerable precision payload or real formatter call was used. This corroborates
the inspected library/CLI separation, not all possible documents, bundler outputs
or independent consumers. The 10 MiB compressed-file gate, external-file restriction
and preview CSP are not claimed as advisory-specific defenses or ZIP-bomb bounds.

For braces, the installed runtime reverse-dependency closure is the single Next
lint chain above; package-author development metadata (for example Mermaid's own
micromatch devDependency) is not a consumer runtime edge. Within the installed
Next lint plugin, only `no-html-link-for-pages` uses `getRootDirs()`. That helper
calls fast-glob solely for explicitly configured `settings.next.rootDir` strings
or string-array entries. Both tracked root/demo configs leave it absent, so the
ordinary cwd is returned literally without glob parsing. Filenames and JSX hrefs
are used as path/matching data, not fed back as brace-pattern templates.

`lib/dependency-advisory-boundary.test.mjs` persists both isolated probes with
small in-memory fixtures, positive interception controls, a child memory/output
cap and a short timeout. Hooks live only in the probe children, never production.
These tests guard the observed boundaries and must be reviewed on dependency
upgrades; they do not test vulnerability payloads or certify unrelated consumers.

A bounded helper probe confirmed zero glob calls for a literal cwd containing
shallow braces. Harmless explicit string/array settings triggered the stubbed glob
export as positive controls; no real glob or recursive brace parser was executed.
This confirms the configuration gate, not a repaired parser. Keep future rootDir
patterns trusted and bounded; input length and expansion range limits alone do
not establish nesting-depth safety.

**Disposition:** affected installed packages remain tracked, but no ordinary
HTTP/preview/session/file-content path to either vulnerable input was identified
under these exact sources/configs. No audit ignore, forced override, lint-rule
removal, library replacement or runtime-module pruning is warranted solely by
these findings. Agents' arbitrary shell commands, executable lint configs,
extensions/plugins and other consumers can intentionally invoke installed parsers;
those are separate trust scenarios, not automatic unauthenticated app-input paths.
Reassess after dependency/config/import or packaging changes. This is bounded
source and sentinel evidence, not a whole-service security audit, formal proof,
live deployment observation or complete bundled-code inventory.

This guide owns revisiting these two exposures and deferred majors on dependency
refreshes. Do not add blanket audit ignores or call this candidate audit-clean.
Nix input vulnerabilities and complete distributed-artifact review are separate.

## Redistribution licenses

Lockfile classification is not a license exemption. Root, Nix and demo artifacts
need notices based on what is actually redistributed, including bundled code.
Preserve MIT/ISC/BSD copyright/license texts and Apache licenses/applicable NOTICE
material. Notable expressions include Mammoth BSD-2-Clause, JSZip
`MIT OR GPL-3.0-or-later` (use MIT), DOMPurify `MPL-2.0 OR Apache-2.0` (use
Apache-2.0), and Pako `MIT AND Zlib` (both obligations). Argparse 3 records
**PSF-2.0** as an attribution correction; preserve applicable Python/PSF notices
for shipped copies rather than treating the old lockfile label as authoritative.

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
application's >=24.0.0 requirement. The existing initialize/parse/render
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
