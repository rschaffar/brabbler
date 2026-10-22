# Opt-in acceptance widths and reviewed core batches

## Decision

Preserve ADR 0025's three mandatory levels, immutable package/source boundaries,
ordinary Nix browser sandboxes, genuine deployment VM, exact coverage, original
deadlines and failure/settlement checks. Supersede only its four-sandbox maximum
for explicitly requested experimental browser widths.

- Keep the recommended full-acceptance profile at four core workers/four browser
  sandboxes, the automatic browser ceiling at four, and existing bare-CLI defaults.
- Admit explicit browser widths through eight. Wider profiles are opt-in scaling
  experiments, not a new default or a claim of measured eight-wide reliability.
  Preserve per-group CPU/memory admission and whole-group isolated sandboxes.
- Match explicitly widened fresh core selections with up to eight actual Nix
  cores per build, retaining the original builder allocation as a worker cap.
  Combined admission accounts for both realization peaks and worker memory;
  insufficient headroom still refuses a selection or serializes levels as before.
  An overlapping benchmark must not silently reinterpret serialization as overlap.
- Continue using the existing F/N pool and E barrier. Promote a default-E file
  only after reviewing its actual fixture/helper effects; a separate process
  isolates globals, not the shared writable source tree or unscoped host effects.
  Preserve serial cases within each file. Missing/uncertain review remains E.
- Retain hash-bound audit evidence and file-specific reasons. Saved review data,
  successful checks and resource estimates are not new execution/Git authority,
  reservations, or proof of future changed test code.

## Evidence and limits

The reviewed batch admits 86 synthetic/read-only and 42 private-fixture/native
files. It retains 64 unresolved original defaults and every prior explicit hold.
New unreviewed files continue to default E. Substantive original test bodies and
assertions are not weakened by scheduling classification.

A separate instrumented Nix run checks native overlap and inotify-visible source
changes plus final content/mode identity. This is bounded diagnostic evidence,
not certification of restored mmap/external-hardlink writes, arbitrary host effects
or escaped descendants; Nix remains the outer containment owner.

A same-width, core-only 16-worker pair observed about 34% less command wall time;
an earlier full four/four pair was slower. Later main compositions have separate
complete acceptance, not relabelled comparison inputs. No full eight/eight pass,
statistically repeated causal speedup, cold-cache promise, ARM or CI result is
claimed. Exact observations and the narrowly authorized responsive-fixture wait
correction are retained in the completed audit plan.

## Ownership

[Testing](../testing.md) owns current invocation, admission and measured results.
[Browser acceptance](../../e2e/README.md) owns group/fixture isolation.
The [completed audit plan](../plans/archived/2026-10-22_default-exclusive-audit-plan.md)
and `nix/test-lanes-audit-2026-10-22.json` retain the source-bound review evidence.
The global Git lifecycle still owns exact integration and separate cleanup;
experimental profiles do not change any operation permission or remote boundary.
