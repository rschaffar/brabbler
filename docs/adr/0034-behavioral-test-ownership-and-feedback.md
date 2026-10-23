# 0034 — Behavioral test ownership and efficient feedback

## Decision

Keep the three mandatory Nix acceptance checks and real deployment boundary from
ADR 0025. Overhaul ownership inside those checks, not the production environment
or worker budget. The user authorized behavior-preserving production testability
refactors, consolidation of overdone tests and retirement of internal test APIs
and group names without adapters. Keep `core`, `e2e`, `service` and `all` entry
points stable and update their in-repository callers.

Test-only DOM dependencies have a separate private manifest/lock under
`lib/testing` and a separate Nix support derivation, linked only into private
core/static workspaces. The package deliberately exposes its immutable application
module set at runtime, so a root devDependency would still ship. Keep that
application dependency graph unchanged: no runtime pruning, second node-pty
rebuild, or DOM support in the package. The support manifest must not install a
second React; the real renderer and components resolve the application React.

Each contract has a primary owner at its lowest sufficient boundary:

- Direct production-module tests own policy/data matrices; they must not require
  a Git history, SDK startup or a browser merely to vary a decision.
- Instance-owned production controllers with narrow capabilities own asynchronous
  orchestration, clocks and persistence ordering. Their real default composition
  remains independently exercised.
- Mounted React tests own effects, closure freshness and cleanup. DOM emulation
  is not proof of layout, native capture, scrolling, media or browser networking.
- Private native integration owns kernel/path identities, Git refs/locks,
  descriptors, SDK resources and process closure.
- Installed-package Chromium owns browser-native behavior and thin end-user
  connections, not exhaustive repetitions of lower-layer truth tables.
- The existing genuine Home Manager VM owns activation, durable restart, PTY and
  service/cgroup/port closure; browser process receipts never replace it.

A removed expensive test needs a named replacement/bridge, or an explicitly
obsolete obligation. Identical error text does not establish identical safety.
Fresh authorization/capture checkpoints, direct-ref identities, race stages,
filesystem aliases and before/after-effect persistence failures remain distinct.
No approved snapshot is cached to reduce native revalidation cost.

## Completion and time

Result availability, owned-work settlement and durable publication are different
facts. Production owners retain complete work promises, including failure and
persistence handlers. A terminal status or stop request does not certify closure.
Fixture teardown stops its admission, releases gates, requests only cancellation
it owns, joins work/closure, restores globals, then removes private resources.
Observer disposal must not cancel independently admitted Acceptance jobs (ADR 0031).

Use named request/operation barriers and controlled clocks for project-owned
elapsed-time policy. Do not infer settlement from fixed delays or universal idle/
microtask-flush helpers. Bounded external-condition polling and selected real
interval/deadline/native-close proofs remain valid. Keep original browser
assertion deadlines, unsuppressed errors, failure evidence and no automatic retry.

Small `.fixture.mjs` helpers provide deferred work, joined ownership and real React
mounting through `lib/testing/async.fixture.mjs` and `react.fixture.mjs`.
`createTaskOwner().track(label, work)` retains complete work; `join()` closes
admission and awaits peers even after failure. `mount(t, element, options)` defaults
to StrictMode and owns event/storage globals and failure-safe disposal. Neither
helper certifies native closure; DOM emulation never proves layout or real capture.
Do not build a fake DOM or migrate runners by habit.

### Bounded DOM outcome and remaining boundaries

Accept **`jsdom@27.0.1` pinned in private test support**, not the root manifest:
the earlier focused Nix pilot passed real TSX, shared React identity, Strict
Effects, events, storage and cleanup. A root devDependency would ship because the
package's `node_modules` symlink exposes the full application module set. jsdom
therefore lives only in `lib/testing/package.json` and its private lockfile.
`nix/test-support.nix` built successfully without React or node-pty and is linked
only at `lib/testing/node_modules` in private core/static workspaces. Root app
dependency versions and the devshell preparation contract remain unchanged; the
cache hash binds the changed package-inventory manifest. Focused Nix mounting
checks verify the shared application React identity in this composition.

Application source sets exclude test/fixture files and `lib/testing`; package
exclusions agree. Realized package/closure inspection found no jsdom, own support
helpers or test-support output in runtime. Input-graph probes cover application,
fixture, classified-test and dependency changes, including support-only dependency
changes leaving package/runtime identities unchanged. Complete candidate acceptance
is a separate obligation, not inferred from these bounded packaging proofs.

The three source checks in retired `hooks/model-switching.test.mjs` are replaced
by strengthened actual production callbacks/loader tests in
`hooks/useAgentSession.model-selection.test.mjs`, retaining Chromium bridges.
Callback execution is not mounted React proof. Actual mounted GitExplorer/Move
tests are now present without production changes; they deliver ignored-abort JSON
and join failure cleanup. Focused Nix checks and independent stale-acceptance
mutations exercise these owners. Broader full useAgentSession/FileViewer mounting
is deferred. Other source-shape families are not all migrated.

## Fixtures, classification and evidence

Browser recipes declare ordered resources and expected IDs independently of
observed seed output. Only timestamps, appearance, Activity and Markdown omit the
audited manager/fork prelude setup; no omission follows merely from a group name. Shared
model defaults and feature transcripts are separate ordered fragments, both
retained for every current browser-suite recipe. Retain whole-chain
success-only receipts, input variants, prerequisite ordering and a fresh ordinary
sandbox for each group. Reorganizing owners requires an independent old-to-new
obligation/input mapping. Distinguish actual browser abort from delivered/consumed
JSON; abort does not prove ignored-cancellation stale suppression. Natural polling
is passive observation, not synthetic wake events. Partial-stream UI simulations
retain a separate real SDK/faux-provider canonical-turn/reload bridge.

Keep explicit current F/N/E review in the live manifest and fail-closed unknown
handling. `manifest.holds` records explicit unresolved E reasons;
`nix/test-design.mjs` requires an isolation rationale or justified hold. Unknown
files still warn and execute exclusively as E, never disappear. Historical audit
records remain **immutable** evidence of their original revision, separate from
live classification, not a requirement to retain every old filename, lane, estimate
or body. Changed fixture/helper/native effects require review; hashes are not
future authority.

Deterministic static preparation uses separate reusable Nix **typegen/tsc** and
**lint** dependencies bound to their actual declared inputs, toolchain and recipes.
Registered JS entrypoints and live Node scheduling metadata are excluded from the
TS input graph; typed imports of those excluded modules are rejected. Adding a
classified JS test can reuse unchanged type evidence while invalidating lint.
TS/TSX fixtures and the application/configuration graph remain inputs. Every
executing core selection still requires all static checks and fresh selected
effectful execution through its nonce. Reports distinguish reused static evidence
from execution; inventory-only is neither. Narrow inputs only with graph verification
that relevant sources/configuration remain. No cached result is called a new
execution or operation authority.

### Fresh browser definitions, not cached execution

After original support/metadata validation, each invocation owns one tiny selected
Nix definition-manifest publication. It preserves constant references to unchanged
capsule `.drv` files, original support and pinned source; output paths are identity
data only. Keep the published payload's context: stripping it would lose definition
retention, while retaining output context would run capsules before admission.
Avoid an `outPath` data key, which can coerce an entire Nix set during JSON encoding.

Validate the bounded immutable manifest's exact source/system/UUID/digest/namespaces,
selection and group/path map before dispatch. Its out-link roots definitions for
this run, not an approval or result cache. Manifest errors fail before native
admission; owned publication and started peers must still settle on failure/abort.
Unchanged weighted lanes individually realize exact `drvPath^out` at the original
budget, then require physical output equality and every existing strict verdict.
Each actual capsule retains a fresh nonce, private sandbox, installed launcher and
native checkpoints. No persisted manifest/nonce replay, shared sandbox, execution
reuse or new native/Git authority is introduced.

## Performance and rollout

Attribute core/static, native setup/execution and browser preparation/scenario/
trace/export costs before choosing optimizations. Freeze separate focused-loop
and complete-command targets against a verified control at the same four/four
budget. Report preparation and execution separately, preserve slow/failed results
and do not extrapolate warm local measurements to cold caches, CI or other hosts.

Migrate bounded families with meaningful red/green defects, native bridges and
independent review before deleting old assertions. Keep conditional migrations and
unresolved native holds explicit. Group splitting and immutable-seed adoption are
deferred unless measured benefit warrants them. The independent native seed pilot
checked real config/ref/registration/file/pack inode independence, but saved only
~5.66ms (~13.4%) construction per fixture across seven balanced samples; this does
not justify infrastructure against dominant capture/execution costs. No approved
snapshots are reused. Private source-variant Git/inventory instrumentation is
operation-count evidence, not final-candidate timing or additive wall time; the
stronger held-HEAD server guard is retained. Browser packing hints live in
`nix/browser-plan.mjs`, with the measured source recorded beside each refreshed
value, never as deadlines, resource admission or coverage authority.

Current contributor recipes belong in `docs/testing.md` and `e2e/README.md`;
source-bound measurements, retractions and implementation status belong in the
test-suite architecture overhaul plan. Keep scoped proofs and cold preparation
separate from warm performance samples. Complete static/core/browser/service
acceptance and matched performance evidence are distinct completion gates; this
decision alone never certifies either.
