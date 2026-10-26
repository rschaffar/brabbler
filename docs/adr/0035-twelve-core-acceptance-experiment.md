# Twelve-core acceptance experiment

## Decision

Extend ADR 0032's explicit fresh-core allocation ceiling from eight to twelve
Nix cores per build so `all --workers 4 --jobs 12` can actually admit twelve core
file workers. Requests above twelve remain capped to twelve allocated cores;
requests through eight and bare-CLI defaults are unchanged. Browser allocation,
F/N/E scheduling, coverage, isolation, deadlines and settlement are unchanged.

Preserve aggregate admission, including both possible core builders. Twelve core
workers/four browser sandboxes require an estimated 32 effective CPUs and 43 GiB
available memory to overlap. Insufficient headroom serializes levels normally;
this estimate is not a reservation or measured RSS requirement.

The user requested this experiment and conditional adoption if faster. A fresh,
source-identical warm overlapping comparison passed complete acceptance in
374.251s at four/four and 293.271s at twelve/four (21.64% less command wall time).
Adopt explicit `all --workers 4 --jobs 12` as the standard recommended invocation
when overlap is admitted, superseding only ADR 0032's four/four recommendation.
Retain four/four as the resource fallback: the initial serialized twelve/four run
took 517.175s, including 42.556s before core execution. Preserve bare-CLI automatic
defaults, the Acceptance editor template and existing user-owned profiles/settings.

This is one warm pair on native x86_64 Linux, not a cold-cache, repeated statistical,
ARM or CI guarantee. Serialization is valid acceptance, but not evidence of a
speedup over an overlapping control. Testing owns the detailed phase evidence.

## Ownership

[Testing](../testing.md) owns current invocation guidance and acceptance evidence.
The experiment plan records exact source identities, execution widths, timing,
results and any unresolved comparison limits. No host-service, remote-operation,
Git approval or cleanup boundary changes.
