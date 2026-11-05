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
- [ ] Run focused Nix checks during development, then complete core/static/plugin, browser/terminal and deployment acceptance on the settled candidate. Record exact source identity, commands, effective budgets, durations and evidence.
- [ ] Commit coherently, rebase onto current local main, reassess evidence and obtain exact-state non-FF integration approval. Handle cleanup separately through native policy.

## Risks

Busy-parent context must not clone unresolved tool calls or approval authority. Source/child identity must survive reloads, branch changes and relocation without stale UI publication. Simultaneous first sends must not create competing children. Family expansion must not accidentally make BTW delegated work. Chat-only restrictions must hold after cold reopen and API calls, not just in the panel.

## Rollback / Recovery

Session writes use existing persistence barriers before publication. Creation errors remain errors and must not replay a model request automatically. Saved BTW sessions survive panel closure and restarts; interrupted execution follows normal session recovery. Do not automatically delete saved conversations on failure. Metadata is versioned and unknown forms are not interpreted as authority.

## Completion Checklist

- [x] Saved BTW history and context are inspectable and attached to the exact source.
- [x] A waiting source question and its draft remain unchanged while BTW answers independently.
- [x] No tools, native resources, parent notification, automatic approval or automatic main-chat send is available through BTW.
- [x] Catalogue/lifecycle tests and desktop/mobile connection proofs pass.
- [ ] Complete acceptance, independent review, maintained documentation and exact-state integration are recorded.

## Current status

Backend and family behavior are implemented and passed focused Nix execution, including real JSONL creation/refresh, cold startup restrictions, relocation/deletion, late startup refusal and branch-local snapshot display. Mounted source-question preservation and secondary Stop ownership passed; a private source mutation removing the secondary guard failed the intended behavioral assertion.

Independent backend/UI reviews identified and corrected cold-writer races, retry discovery, compaction retention, branch selection, readiness checks, child composer ref ownership, breakpoint/overview coverage, notifications and post-commit focus restoration. Maintained contracts are in `docs/session-internals.md`, `docs/feature-internals.md` and `docs/questions.md`.

Focused acceptance passed: seven core files / 64 tests plus static checks (48 seconds command wall time), and all four `running-forks` scenarios including both new BTW inputs (102 seconds command wall time including package realization; 14.449 seconds browser capsule execution). The real configured loopback provider, waiting source, recall/focus/navigation and draft-only handoff are covered. Private logs retain source manifests and failures; fixture omissions and browser predicate/selector ownership errors were corrected, not relabelled as application success.

Current gates: complete core/static/plugin, full browser/terminal and Home Manager deployment acceptance, followed by exact-state integration. No full-acceptance or integration claim yet.
