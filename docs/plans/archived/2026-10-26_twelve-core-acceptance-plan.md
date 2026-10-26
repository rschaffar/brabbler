# Twelve-core / four-browser acceptance experiment

## Goal

Execute fresh full acceptance with twelve effective core workers and four browser
sandboxes. Adopt this invocation for future work only if comparable complete
acceptance demonstrates faster feedback without weakening existing checks.

## Context and relationship

User-authorized bounded experiment from local main
`3650d2e857f18c7dbcef412f44e435c0f5d363b3`, isolated in branch
`test/acceptance-12-core-4-browser`. The user asked to execute even if normal
admission serializes levels; no resource-estimate bypass is authorized.
ADR 0035 extends only the core allocation cap. The existing eight/eight plan
retains its separate unfinished scope; the core optimization plan owns code/fixture
optimization, not this width experiment. No reclassification, test retirement,
application changes, deadline increases, or host-service interaction are included.

## Plan

- [x] Identify the eight-core allocation cap and extend explicit core allocation
  through twelve, retaining automatic admission and unchanged smaller selections.
- [x] Verify allocation boundaries and failure/settlement contracts in full Nix
  acceptance at `all --workers 4 --jobs 12`; record widths and overlap honestly.
- [x] Compare fresh `all --workers 4 --jobs 4` against a warm overlapping twelve/four
  run on identical tested source; all levels passed. The initial serialized run
  remains separate, not relabelled as a comparable overlapping result.
- [x] Independently review the bounded allocation diff (no blockers) and adopt
  twelve/four invocation guidance, retaining four/four when overlap is unavailable.
  Independent final documentation/evidence review also found no blockers.

## Stop conditions

Preserve the first failed run; no unchanged automatic retry. If complete acceptance
fails, diagnose exact evidence and retain the candidate rather than changing the
recommendation or broadening the task into unrelated fixes. If timings are not
comparable, retain four/four guidance and report the comparison gap.

## Evidence and disposition

All three fresh full commands passed 510 files / 4,208 tests / 14 suites, all
26 browser/terminal groups and genuine deployment, with no skipped/cancelled core
tests. Requested/effective/peak core widths were 12/12/12, 4/4/4 and 12/12/12;
browser width remained four. Exact commands, source/package identities, phase
intervals and report roots are retained in
`/tmp/pi-web-12core-benchmark.i_aozju8/comparison.json`.

- Initial serialized twelve/four: 517.175s, including 42.556s before core lifecycle.
- Warm overlapping four/four: 374.251s, 1.641s before core lifecycle.
- Warm overlapping twelve/four: 293.271s, 1.570s before core lifecycle.
- Warm-pair command saving: 80.980s / 21.64%; one native x86_64 pair, not a repeated
  statistical, cold-cache, ARM or CI guarantee. No separate deliberate prewarming.

All runs used `/nix/store/llj7xmamq43q5683d258c1ypzk0l22xp-source`, digest
`faff73cfe4d63d3b3e428bbd92fa53ea5878d5b28b8055b10d1bd5f5cd345f14`.
The warm-pair core roots are `/tmp/pi-web-test-core.WRJpJU` and
`/tmp/pi-web-test-core.aH6teN`; browser roots `/tmp/pi-web-test-browser.rUaUdx`
and `/tmp/pi-web-test-browser.3xP8gP`; deployment roots `/tmp/pwv-IqQAgq` and
`/tmp/pwv-pzzJg5`. The summary retains the first run's reports too.

ADR 0035 owns the bounded allocation/recommendation decision. `docs/testing.md`
owns current admission, measured phase evidence and limits; AGENTS/README/browser
instructions now recommend the explicit twelve/four command when overlap is admitted.
Bare-CLI automatic defaults, the Acceptance editor template and user-owned settings
are unchanged. No remote publication or installed-service changes occurred.
Recommendation/evidence-only Markdown changes followed acceptance; 1,398 exported
non-Markdown files were byte-compared unchanged against the passing snapshot.

## Completion Checklist

- [x] Full three-level acceptance passes with recorded requested/effective widths,
  source identity, exact commands, end-to-end timing and retained artifact paths.
- [x] Recommendation follows the measured warm comparison with its finite limits.
- [x] Hand off the isolated verified candidate for separately gated exact-state local
  integration and cleanup; those operations remain governed by the Git lifecycle.
