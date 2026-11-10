# Dependency refresh

## Goal

Update the dependency candidates approved on 2026-11-10 while preserving the
application's security, installation, rendering and Nix acceptance contracts.
The owner selected jsdom 31.0.0, rather than the smaller 27.4.0 update, and
explicitly chose to preserve the streaming-only cache-warming default. Explicit
global choices remain live; no operator settings file is migrated or written.
The owner also selected native Next compression, including small unknown-length
responses, and explicitly deferred a new native macOS archive smoke until
publication as a bounded exception for this update's local integration.

## Scope and relationships

Start from cleaned local `main` at `11ffbdae`. This plan owns the dependency
refresh; the public-release plan continues to own publication, portable release
certification and deployment. No Git remote publication, installed-service
activation, unrelated UI synchronization or cleanup of historical resources is
included. Existing application work plans retain their feature scope.

Targets: Node 24.22.2 with the required shared-Brotli decoder fix; coordinated Pi
1.5.1; Next/eslint-config-next 16.4.6; Pierre 1.6.4; Mermaid 12.3.0; Playwright
1.65.0; direct TypeBox 1.4.6; web-push 4.0.0; private jsdom 31.0.0. Preserve
TypeScript 6.0.3, Node-24 typings, native PTY and the reviewed KaTeX/Undici
exceptions. Refresh owned transitive resolutions deliberately, not with forced
peer resolution, blanket overrides or a toolchain-major migration.

## Plan

- [x] P1: Resolve the Node/shared-Brotli recipe and immutable upstream inputs.
  Prefer the current upstream Nixpkgs recipe; if insufficient, preserve its slim
  runtime/wrapper/platform structure in a narrowly documented overlay. Verify the
  actual interpreter and native dependency ABI before package acceptance.
- [x] P2: Update root/demo/private-test manifests and locks. Requalify Pi's exact
  environment patch, MCP guards and complete standalone exclusion; preserve the
  security-fixed Undici resolution. Review TypeBox's independently pinned SDK
  copy, Next's actual compression path, web-push 4 and jsdom 31 compatibility.
  Regenerate the two Nix dependency hashes from realization and review peer and
  audit results without suppression.
- [x] P3: Update Mermaid/ELK notices and matching covered-source assembly from
  actual resolved inputs; preserve KaTeX renderer/CSS alignment. Verify assembled
  source metadata and actual package/archive inventories, not lock labels alone.
- [x] P4: Run narrow affected checks while editing, separately verify demo
  typegen/typecheck/lint/regressions, and obtain independent source review. Resolve
  real failures without retries-as-fixes or weakened assertions/deadlines.
- [x] P5: Run complete fresh Linux Nix acceptance (`all --workers 4 --jobs 12`
  when resources admit overlap; otherwise record the concrete reason/budget).
  Retain exact inputs, preparation/execution/command intervals, failures and
  immutable reports. Verify package source/notice inventory and ordinary Linux
  exact-archive installation where affected; report unavailable native macOS
  evidence as an outstanding release gate, never inferred from Linux.
- [x] P6: Move durable maintenance facts into their owning guides; summarize
  verified scope and remaining limits. Prepare the reviewed feature for rebase
  and exact-state local integration. Native Git receipts, not this implementation
  plan, own the subsequent unsigned non-FF merge approval/effect and cleanup.

## Compatibility assertion dispositions

Original coordinates below refer to immutable base `11ffbdae`. These are focused
compatibility results, not a substitute for the complete acceptance gate.

| Original assertion/input | Disposition and receiving owner |
| --- | --- |
| `lib/next-compression-compat.test.mjs:22-99`, six predicate/profile/install guards | Obsolete with removal of their temporary adapter/preload. Native Next scalar-header/multiple-value assertions and unmodified HTTP bridge own the replacement; the separate authentication preload remains tested. |
| Same file, `101-165`, gzip/refusal/threshold/MIME/error/framing matrix | Preserve actual gzip/decode/refusal, no-transform, HEAD/bodyless and media checks. The owner explicitly selected native small/HTML/unrelated-JSON compression; production SSE headers retain no-transform. Retire only the old adapter-specific plain-body expectations. |
| `components/ChatInput.test.mjs:400,405,416,419,435,437`, zero length and 156/299px available-height inputs | Strict CSSOM `0px` and canonical `min()` spelling preserve semantics, subscriptions and cleanup. An added 456px-available input still requires the independent 400px cap; a private production fault fails exactly at 456 versus 400. |
| `components/MobilePwaLayout.test.mjs:59`, eight mobile/busy/queue inputs; custom panel `ChatWindow.extension-request.test.mjs:212` | Keep every input, element identity/layout/focus assertion and exact zero; only the serialized length becomes `0px`. |
| `ChatWindow.extension-request.test.mjs:189`, ask/input countdown clocks | Application 1000ms intervals, 2→1→0 display, server-only expiry authority and interval release remain controlled. Only jsdom's known native 60-Hz rendering/focus interval bypasses the application clock double. |
| `hooks/useViewportHeight.test.mjs:71,124`, finite IME/viewport frame and timer sequences | Cases remain unchanged. The shared DOM-creation owner joins the one initial document `pageshow` before rendering; no timer/frame drain or longer deadline is introduced. |
| Settings autofocus/modal and lower-UI timer fixtures | Preserve exact 30ms autofocus, route/body/failure/cleanup assertions and denied application capabilities. Separate only jsdom's host rendering cadence; actual receiving Settings/Models/Agents/Worktree/lifetime tests pass. |

The streaming-default counterexample fails the named `idle` versus `streaming`
assertion without the host policy. The new source-tree ordering regression fails
with Path-component ordering and passes with POSIX-name ordering. No fault variant
is an application input. Raw failures and source/control identities are retained
privately; the maintained guides own current behaviour and limits.

Independent review found two fixture-only issues in the initial timer exception:
copying the host exception into `window.setInterval`, and cancellation of arbitrary
unknown native handles. Both are corrected. The private rendering-clock owner now
tracks exact opaque handles, keeps realm application intervals denied/controlled,
and reports/releases surviving admitted handles after realm close. A real private
fault removing the identity guard fails the native-cancellation observation
(expected zero calls, observed two). A final narrow disposal-capture fix retains
the packet view before card loading/rendering can reject; both disposal and
rendering-owner cleanup are still attempted independently.

jsdom 31 retains `window.document` after close. The shared-session cleanup oracle
now checks public `document.hasFocus()` true before and false after actual disposal,
not deletion of that property. Every exact error graph/original cause, callback,
descriptor, listener, completion and native-root-fence assertion remains.

## Verified receiving candidate

All approved targets are implemented. Three complete Nix levels ran separately
against the same immutable package/modules/source/archive output identities;
these are not one combined-command or cold-cache timings.

| Evidence | Selection/result | Command wall time / separate intervals |
| --- | --- | --- |
| Complete core/static/plugin | 534 files, 4,638 tests, 14 suites; no failed/skipped/cancelled tests; 12 requested/effective workers | 304s; 33.0s before lifecycle, 265.2s test-file window |
| Complete browser/terminal | All 26 groups / 61 receipts, four sandboxes, pinned Chromium 157.0.8103.38 | 350s; support 81.5s, manifest 5.0s, group-client window 257.6s |
| Genuine Home Manager VM | Activation, permissions, durable writes/restart, real HTTP PTY and shutdown/collection | 99s; guest proof window 20.9s; remaining realization/orchestration not independently divided |
| Post-review current static/changed-file checks | Entire changed card file plus rendering support and shared-session cleanup control: 37/37 tests | 42s; this is not a second complete core execution |
| Independent demo | Typegen/typecheck/lint, two search cases, eight actual-config lint probes | 24s after 9s installation; one scratch-layout missing-parent-manifest precondition corrected |
| Ordinary Linux exact archive | Clean Node 24.22.2 container: install/SDK policies, auth/restart/rotation, HTTP PTY and source/notices | 16s; no host service or operator state |
| Evaluation-only / inventories / audits | Nix no-build preflight; archive excludes tests/fixtures/demo/private DOM; runtime closure excludes test support; root/demo nine moderate lint-chain package findings, runtime-only zero; support zero | Preflight 5s; no forced audit fix or blanket override |

Core outer content/mode digest:
`a3be885e253fbf4a64c41d9a9bf9663586f008b2d24fb713b666e44ab4dc135d`.
Browser outer digest:
`83cf69a14b9850c8de01a9324a0b5b1dcda1d4e4444b8246a3a969e46b205088`.
The final test-only ownership change was checked at its own later snapshot;
unchanged tests/application results are not relabelled as new-tip execution.
The final package identity is `mcz1mdi4pgx92xmwakbdvylncpixzlqm-brabbler-0.1.0`.
Exact application/source archive SHA-256 values live in [release status](../../release.md).

**Count correction:** an earlier uncommitted draft conflated the demo's ten total
checks with ten search cases. The actual output is two search tests plus eight
lint probes; the superseded draft is retained privately. No test result changed.

Earlier focused realization warmed prerequisites. Separate/overlapping intervals
are not additive performance measurements; model/research/coordination time is
excluded. Initial static/Pierre API, native-compression threshold and jsdom
serialization/document/clock/oracle failures are preserved privately, diagnosed and
corrected without suppression, longer deadlines or unchanged automatic retries.
Independent production/assembly review found no additional concrete issue; fixture
review findings are resolved as above. No production changes followed the passing
browser/VM/archive snapshots; Nix output identities were compared explicitly.

Final source checks resolve all 164 maintained Markdown local destinations
(filesystem checks, not browser verification). Code examples and unchanged upstream
notices are not maintained-link assertions. Git's full whitespace advisory reports
only the exact upstream GWT COPYING copies and EMF parent POM; their original
bytes are retained deliberately. First-party whitespace checks remain clean.

Durable facts moved to dependency, SDK, model/native-tool, testing/session, source
availability and release guides. Remaining limits have current owners: native
macOS archive smoke stays at the publication gate by explicit owner decision;
minimatch lint advisories and source compilation/provenance limitations remain in
[dependency maintenance](../../dependencies.md) and source/release guides. No
remote operation or host activation is included. Native Git receipts own the
subsequent exact-state integration approval/effect and resource cleanup.

## Current blockers and stop conditions

- Resolved: upstream Nixpkgs `f4a03c008967841f2a0b3cb7c436fc6fc31671f6`
  supplies the actual Node 24.22.2 slim runtime and shared Brotli 1.2.1, which
  contains the required release-branch decoder fix. The modules realization
  succeeded; actual runtime/native/complete acceptance evidence remains due.
- Pi and Next deliberately refuse unknown upstream versions/bytes. Do not weaken
  these guards to make installation or startup pass.
- Mermaid 12.3 changes its ELK dependency family; the previous 0.9.3 source output
  cannot be relabelled as matching the new payload.
- Stop and report genuine package/API incompatibility, unavailable required
  source provenance, unexpected checkout changes, conflicts or resource limits.
  Ask only for a material scope/authority decision, not routine implementation.

## Completion checklist

- [x] All approved dependency targets are implemented, or an explicit owner
  decision records a bounded exception.
- [x] Full application acceptance, separate demo evidence and required artifact
  checks are recorded for the settled input identities.
- [x] Independent review findings are resolved; remaining platform/release limits
  are explicit in maintained documentation.
- [x] The reviewed, verified feature is ready for the native Git integration
  handoff; remote publication and host deployment have not occurred.
