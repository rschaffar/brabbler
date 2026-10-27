# Production catalogue performance

This guide owns the recorded production findings and remaining measurement
follow-ups. The [executed profiling plan](plans/archived/2026-10-26_pi-web-production-profiling-plan.md)
retains detailed methods, failed attempts, source identities and acceptance logs;
it is historical evidence, not permission to replay its commands or collectors.
[Session contracts](session-internals.md) owns the implemented mechanisms and
[Testing](testing.md) owns current sandboxed verification.

## Recorded findings

The 2026-10-26 Deep Thought observations used Chrome 155/Linux, a warm installed
service, normal desktop load and private timing/count-only diagnostics. The
metadata inventory found 5,283 JSONL files totalling 7.12 GiB; that was not a claim
that ordinary refreshes reread them all. Scanner unchanged-file and append-tail
shortcuts already existed.

The dominant measured extra pass was synchronous fork/subagent relation metadata
reading/parsing downstream of those shortcuts. In the separately approved 20s V8
probe, `buildSessionList` occupied 17.62/20.25s weighted samples (87.0%), with
17.23s (85.1%) in its relation-resolution subtree. Inclusive subtrees overlap;
these are not exclusive CPU-clock or per-request percentages, acceptance-time
fractions or a predicted speedup. Profiling overhead and hidden native leaves
were not independently attributed.

| Warm ordinary root reload observations | Before relation reuse | After the user's relation-reuse rebuild |
| --- | ---: | ---: |
| Enabled-composer upper bounds | 10,908.5 / 7,260.2 / 7,253.9ms | 1,266.6 / 1,056.0 / 1,000.8ms |
| Median | 7,260.2ms | 1,056.0ms |
| Catalogue responses per 20s observation | 5 / 5 / 5 | 5 / 4 / 4 |
| Decoded catalogue bytes per observation | about 48.25MB | 48.33 / 38.67 / 38.67MB |

The observed median waiting fell 85.45%. That is separate measured evidence, not
an inference from the 85.1% sample share. HTML was about 31–170ms; large catalogue
responses and roughly 280–312ms maximum browser timer delays remained after the
first rebuild. Three warm reloads are not statistical, cold-start, mobile, Firefox,
PWA, INP or exact SDK/SSE-readiness proof.

Two quiet 15s windows had six Activity polls each, median 6.30/6.45ms, no long tasks
and only 0.10/0.27s whole-worker CPU. A third window coincided with two catalogue
responses and much more worker CPU; the invalidating event was not recorded.
Short/long explicit deep links spent most observed delay before history fetching
(the history requests themselves took about 74/476ms). These findings prioritize
catalogue work on this host; they do not exonerate every other path. SDK phases
and individual synchronous index flushes remain unmeasured.

A changing snapshot had 5,305 sessions (1,986 subagents, 1,482 forks, 2,215 archived;
categories overlap). An index snapshot's serialized first-message values were
6,051,896 bytes, 55.7% of its 10,866,884 bytes. This is size, not time attribution.
Never copy real transcripts, index contents or authentication into test builders.

## Implemented work and proof limits

- **Relation reuse:** scanner-validated process-private evidence and a compact
  reader WeakMap remove unchanged relation content I/O. The native regression
  observed five opens/reads/fstats before the fix and zero on a warm reconstruction
  afterwards. Changed/raced inputs retain bounded reads and fresh parent lookup;
  this is display metadata, never authorization or a transactional snapshot.
- **Refresh coalescing:** one Sidebar request/body owner merges pending demands
  while preserving forced/mutation freshness and precise caller settlement.
  Mounted checks demonstrate one warm-complete bootstrap, or two requests when
  forced startup notifications overlap, without duplicate Strict bootstrap or
  obsolete hydration. This is controlled work-removal evidence, not a deployed
  request-count or latency comparison.
- **Lossless compact transport:** browser reads opt into a response-local string
  dictionary when conservative JSON savings cover its envelope. Legacy API arrays,
  full messages/names, Agents' raw-text search, skill-envelope interpretation and
  existing labels/tooltips remain intact. Unique text can still dominate; there is
  no total response/decoded-memory cap or persisted dictionary.

For the frozen synthetic 1,000-row/20-prompt-group fixture, actual JSON bytes fell
**8,116,281 → 335,795**; gzip bytes separately fell **35,341 → 7,371**. This does not
predict the private production catalogue's ratio. JSON savings do not in general
guarantee gzip or latency savings. Do not replace full text with a bounded preview
without separately designing its search, label and selected-metadata contracts.

The composed compact-transport candidate `0f75818b50fc534b71985dc0c87e05aaf141d85b`
on local main `8c25dd7` passed full Nix acceptance: **523 core files / 4,291 tests /
14 suites**, **26 browser/terminal groups / 59 receipts**, and genuine Home Manager
deployment/HTTP/PTY/restart/shutdown proof. Command wall was **423.975s**, including
realization; this was not a matched performance benchmark. The archived plan owns
exact source/report bindings, separate phase envelopes and retained failures.
Later evidence/closure prose does not relabel that suite as a newer-tip run.

## Follow-up owner and authorization

**This guide is the current owner** of the deferred post-coalescing/compact-payload
production comparison and a successful normal SPA row-click/switch capture. The
user explicitly accepted that handoff when closing the implementation plan. They
are proposed future measurements, not unfinished implementation or authorization
to deploy/probe now. The first relation-reuse comparison does not measure the later
changes. Cold startup, real mobile/Firefox/PWA, exact input/SDK/SSE readiness and
index-write latency likewise remain unmeasured, not silently certified by Nix tests.

A future capture needs a fresh bounded user request, current installed-source and
runtime identity (a matching version string is insufficient), one owner and an
explicit privacy/capture scope. Deployment, restart, persistent configuration and
inspector activation remain separate decisions. Do not clear live caches/indexes,
start model turns, interfere with other tasks or reuse historical hardcoded PIDs
to manufacture a comparison. Distinguish normal reload, deep link and actual SPA
selection; record overlapping phases separately rather than adding them together.

Keep production diagnostics timing/count-only and private: normalized routes,
opaque aliases and public-source frame identifiers, never credentials, bodies,
session identifiers, screenshots/DOM snapshots or raw HAR/CPU traces without
separate sensitive-artifact authorization. Preserve failed attempts before retries;
a passing unchanged retry is not proof of a fix. Synthetic acceptance fixtures have
their separate contained browser/trace lifecycle under Testing.
