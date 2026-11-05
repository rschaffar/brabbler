# BTW side conversations

## Goal

Provide an always-available chat-only aside without interrupting the source chat, including while a question or approval is pending. Save the aside as a real session attached to its source and support reopening, full-size viewing and explicit context refresh.

## Context

The user approved a non-modal desktop side panel, mobile sheet, one persistent BTW thread per source chat, and chat-only operation. The user explicitly requested implementation of that bounded feature; remote publication is not authorized. Existing subagents report to their parent; BTW must not use that lifecycle. Existing forks copy operational history; BTW instead needs a bounded, attributed, inert context snapshot.

## Plan Relationship

No active plan owns BTW. Account-catalog refresh, Git reviews and session-launch remain separate owners; preserve their existing runtime/account/approval boundaries.

## Architecture

- A versioned, child-ID-bound `brabbler:btw` custom entry identifies the source session and original source anchor. A distinct `btw` relation participates in family discovery without being classified as a subagent.
- The existing JSONL/session/runtime/SSE/composer infrastructure owns persistence, execution and rendering. New creation/context endpoints only coordinate the aside; no second chat engine or subagent completion report.
- A bounded saved snapshot contains source conversation context and an optional display-only waiting question. It excludes unsent drafts, live approval authority and unfinished execution. Opening durably creates/reopens the child without prompting a model. Refresh appends an attributed snapshot; it never changes the source.
- Persisted BTW identity enforces chat-only startup and rejects tool/native-resource escalation. Model/account selections copy explicitly, without copying grants or live state.
- The parent remains mounted while the panel opens. BTW has independent input, streaming, Stop and history. Copy-to-main changes only the draft.
- Family discovery, wire encoding, archive/navigation, relocation and deletion must retain the attachment and explicit scope. Old fork/subagent records remain compatible.

## Plan

- [x] Implement typed metadata/context projection, idempotent child discovery/creation and refresh; verify pure identity/bounds and real session persistence/startup restrictions.
- [x] Integrate BTW into catalogue/family/lifecycle surfaces without subagent notifications or counts; verify relationship round-trip, grouping, relocation and deletion behavior.
- [x] Add the always-available panel, independent composer, source/back/full-size links, context inspection/refresh and draft-only handoff; verify mounted races and installed desktop/mobile blocked-parent behavior.
- [x] Update maintained feature/session documentation and English messages; perform independent read-only safety review and address findings.
- [x] Run focused Nix checks during development, then complete core/static/plugin, browser/terminal and deployment acceptance on the settled candidate. Record exact source identity, commands, effective budgets, durations and evidence.
- [x] Commit coherently, rebase onto current local main and reassess evidence. Hand the remaining exact-state non-FF approval/integration and separate cleanup to the native Git workflow, as specified below.

## Risks

Busy-parent context must not clone unresolved tool calls or approval authority. Source/child identity must survive reloads, branch changes and relocation without stale UI publication. Simultaneous first sends must not create competing children. Family expansion must not accidentally make BTW delegated work. Chat-only restrictions must hold after cold reopen and API calls, not just in the panel.

## Rollback / Recovery

Session writes use existing persistence barriers before publication. Creation errors remain errors and must not replay a model request automatically. Saved BTW sessions survive panel closure and restarts; interrupted execution follows normal session recovery. Do not automatically delete saved conversations on failure. Metadata is versioned and unknown forms are not interpreted as authority.

## Completion Checklist

- [x] Saved BTW history and context are inspectable and attached to the exact source.
- [x] A waiting source question and its draft remain unchanged while BTW answers independently.
- [x] No tools, native resources, parent notification, automatic approval or automatic main-chat send is available through BTW.
- [x] Catalogue/lifecycle tests and desktop/mobile connection proofs pass.
- [x] Complete acceptance, independent review, maintained documentation and the explicit integration handoff are recorded.

## Current status

Backend and family behavior are implemented and passed focused Nix execution, including real JSONL creation/refresh, cold startup restrictions, relocation/deletion, late startup refusal and branch-local snapshot display. Mounted source-question preservation and secondary Stop ownership passed; a private source mutation removing the secondary guard failed the intended behavioral assertion.

Independent backend/UI reviews identified and corrected cold-writer races, retry discovery, compaction retention, branch selection, readiness checks, child composer ref ownership, breakpoint/overview coverage, notifications and post-commit focus restoration. Maintained contracts are in `docs/session-internals.md`, `docs/feature-internals.md` and `docs/questions.md`.

Complete acceptance passed on `df403c46bb1c1c5866f19a2ab783da116dc12667`, rebased onto local main `0ebcbfcabe246020826bab34e8a1a2b5418ef30f`. Complete exported content/mode SHA256: `3f14c6a39e1ee91fbd5c3e91a4df8da66f08f15a269bc34c23e256d7ab4907f2`. The later plan-only archival commit changes no application code, test code or test configuration; the application evidence is reused without claiming a new-tip execution.

| Level and selection | Result | Command runtime and preparation/execution |
| --- | --- | --- |
| Same generated core-check derivation, one unchanged retry; requested/effective `--jobs 12` | 528 files, 4,481 tests; static/plugin checks passed; no skips or cancellations | 334 seconds; static prerequisites already realized; approximately 1.8 seconds until first test, 332.8 seconds test span |
| `nix run .#test -- e2e --workers 4` | All 26 groups / 60 browser-terminal scenario-input IDs passed; four sandboxes | 346 seconds including support realization 80.7 seconds and definitions 4.7 seconds; capsule span 256.6 seconds |
| `nix run .#test -- service` | Genuine Home Manager deployment, restart persistence, production PTY and shutdown passed | 63 seconds including realization; VM script 19.0 seconds |

These final levels ran sequentially: 743 seconds total command runtime, apart from investigation/coordination. Native Linux admission reported 32 CPUs and approximately 51 GiB available RAM for core; widths remained 12/4. Browser/service errors were empty, owned resources settled and ports closed. This is not a cold-versus-warm benchmark comparison. The real configured loopback provider, waiting source, recall/focus/navigation and draft-only handoff are covered.

Private evidence retains earlier failures rather than relabelling them. Fixture compatibility expectations were corrected. An earlier Session Launch connection reset did not coincide with a service crash and did not recur in socket diagnostics or subsequent full inventories; no transport fix is claimed. A later core attempt stopped before tests when its unchanged source-identity guard observed metadata churn on a Nix-store input. All source bytes still matched; hard-link optimisation is the supported explanation, not a proven instantaneous cause. After owned concurrent realization stopped, one unchanged retry passed. No guard, deadline or general error filter was weakened.

## Integration handoff

Implementation and verification are complete; durable behavior is owned by the maintained session, feature and question guides. This implementation plan is retired. The native Git workflow now owns the remaining local-main unsigned non-fast-forward integration, its exact-state approval/result receipt, and separately authorized feature-resource cleanup. Neither this archived plan nor earlier receipts authorize those effects or claim they have already occurred. Remote publication and deployment to the running host service remain outside this task.
