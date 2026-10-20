# Upstream reliability, performance and convenience ports

## Goal

Implement the user's approved seven-item improvement table, listed conveniences and the observed external-reference viewer polish, preserving this fork's account, request, path, session, Git-review and Nix boundaries.

## Context

- Authorization: user requested all table items, all convenience items and the external-file capability-probe polish. MCP/Code mode, sidebar redesign and unrelated upstream work are excluded.
- Dedicated branch `feat/upstream-followups`, worktree `/home/robert/projects/3rdparty/pi-web-worktrees/upstream-followups`, starting local `rst-main` `8e6735a538f113c169b7b17e699bd555a7af551d`.
- Parent is the sole repository writer. Three read-only researchers inspect disjoint source/cached-upstream areas; reviewers do not edit or run competing acceptance.
- Use cached upstream `/tmp/pi-web-upstream-review.KEkJjU/repo.git`; no remote updates. Retain SDK 1.3/Node 24 and immutable packaging. Never inspect live credential files or use live providers/service.
- Standing CodeGraph initialization was attempted in this new worktree and failed with exit 139; normal tools are the fallback.

## Plan Relationship

Existing plans own account identity, questions/receipts, session launch, Git operations and Nix acceptance. This plan changes none of their authority/lifecycle contracts. Maintained architecture, model/session/feature/terminal guides own ongoing behavior; this plan owns only the requested ports and their evidence.

## Plan

- [x] Guard completion-sound/thinking preference storage failures; test blocked reads/writes without losing in-tab behavior.
- [x] Port HTTP idle/connect/proxy reliability compatible with the pinned dispatcher; test timeout propagation and CONNECT routing with synthetic transport only.
- [x] Correct scoped/pinned extension selectors and tool denial for subagents; test explicit denies and reserved-tool boundaries.
- [x] Chunk expanded long thinking without rewriting stored/provider thinking or ordinary answer copying; verify bounded pieces and real rendered output.
- [x] Isolate streaming-reply rendering while preserving history node identity, live cards, stop/recovery and source-entry IDs; verify deterministic render boundaries and browser history.
- [x] Remove provider signatures from browser snapshots/events only; test original/durable messages and replay data remain unchanged.
- [x] Add loaded-prefix CSV/TSV previews and source switching, without a dependency; test quoting/multiline/limits and real file preview.
- [ ] Add full skill instructions with read-only navigable references under explicit loaded-skill authorization; test traversal/symlink/foreign-skill denial and browser navigation.
- [x] Add terminal dark/light themes, chat-font-size following and mobile extra keys; test resize/input/disposal invariants and genuine PTY/browser interactions.
- [x] Expose SDK-native per-model Base URL and Claude adaptive-thinking controls; test validation/round trips, capability visibility and account isolation.
- [ ] Correct Markdown fragments after sanitizer prefixes, currency/CJK parsing and mobile patch layout; test security/source-line preservation and desktop/mobile rendering.
- [ ] Avoid outside-root edit/Git probes in FileViewer without widening roots; prove intentional source links still open read-only with no spurious console/HTTP errors.
- [ ] Update maintained owning guides and add any necessary durable decision record; independently review all changes and resolve findings.
- [ ] Run focused Nix checks during editing, commit coherent reviewed changes, reassess/rebase current local `rst-main`, then run complete fresh core/static/plugin, all browser/terminal groups and genuine Home Manager deployment VM acceptance. Record exact inputs, failures, commands, runtime and artifacts.
- [ ] Hand the clean verified candidate to the Git lifecycle's completion decision; integrate only after exact-state approval and clean up only through separate approval.

## Risks and Recovery

- Port behavior rather than replacing fork components wholesale. Keep credentials/account and catalog bindings session-local; provider signatures are omitted only at client boundaries, never from provider replay/disk.
- File and skill convenience links must not become new general filesystem roots. Read-only capability hints do not authorize edits; server checks remain authoritative.
- Stream isolation must not defer blocking interactions, change canonical receipt reconciliation or recreate historical messages per token. Timing claims require measurement, not source shape alone.
- Terminal appearance and keys must not restart PTYs or retry ambiguous input. All network tests use synthetic sandbox-local endpoints.
- No persisted-format migration, remote publication, host deployment/restart or irreversible activation is planned. The initial no-dependency assumption was revised for root-app CJK parsing only: runtime `remark-cjk-friendly` 2.3.2 and direct dev `@types/mdast` 4.0.4, with matching lock/Nix hash. No SDK/toolchain/flake input change or static-demo redesign. Local feature commits can be reviewed/reverted; existing preferences remain best-effort. Preserve failed evidence rather than retrying unchanged tests or extending deadlines.

## Focused evidence, corrections and remaining acceptance

The implementation is present for every requested item; the reader/Markdown/probe checkboxes remain open until final-review refinements receive settled-candidate full acceptance. Parent remains sole writer. Reviewers `01a158fd-9739-77cb-bd91-5d2d61b1cf30`, `01a158fd-973e-77cb-bd91-5d2fe9cbadb9`, `01a158fd-9740-77cb-bd91-5d30689dfc9d` are read-only and do not run competing checks.

- Fresh focused core passed **33 files / 256 tests / 9 suites**: `/tmp/pi-web-followups-checks.rUuDOp/core.log`, `/tmp/pi-web-test-core.vkTGW7/run.json`, outer digest `679acbde5e191145bd27dc2acf542acde1fa4e0c5653a9d1417348cbbe325e1b`. Includes native SDK Bash startup/reload positive/negative controls, adaptive/budget payload construction with zero HTTP sends, real skill-content route adversarial files, copy-on-write client boundaries, 1000-chunk selector changes, expanded 100K-character thinking rendering, profile denials and real-source watcher/probe races. Snapshot decoding is not relabeled as a native persisted-wrapper reopen.
- Genuine terminal desktop/coarse-touch portrait passed `/tmp/pi-web-followups-checks.rUuDOp/terminal.log`, `/tmp/pi-web-test-browser.AGRL1I/run.json`, same outer digest. Live theme/font changes preserve PTY PID/environment and SSE identity; one-shot Ctrl/software-keyboard and arrow input use the real shell. Combined focused invocation wall time was **75 seconds**, including realization; it is not the isolated core or terminal execution time or a benchmark.
- Expanded desktop/mobile Markdown/settings/reference acceptance passed `nix run .#test -- e2e --group markdown` in **81 seconds command wall time**: `/tmp/pi-web-followups-markdown.7VHFsU.log`, `/tmp/pi-web-test-browser.g7fkfb/run.json`, outer digest `0331e28eb755f1c833dd4c85daac11a933580e5d2af4e684cf1c8d98dd7561bf`. Covers CSV/TSV virtualization/source overrides, scoped anchors/headings, full/nested skill reader/footnotes/no new roots, real model save/read/inheritance/stale test refusal, interactive external reference/watch/reopen with zero forbidden probes, direct denials, and blocked preference storage. Later exact-anchor priority and identity-bound save refinements are not claimed as having run in that earlier snapshot; full acceptance owns the final proof.
- Final review corrected failed-write/readable-old-value preference rollback, selector save case conflation, ambiguous-longest-name and denial handling, root-only built-ins, document footnote rewriting, deleted-subtree Git hints, cwd lexical checks and stale watcher generations. The latest anchor correction queries explicit ID/name before generated heading data; a collision regression and real browser fixture distinguish them.
- **Retraction:** the original thinking task said unchanged copied text. Existing assistant Copy excludes thinking; native selection across hard-cut blocks may insert line breaks. The actual contract is unchanged stored/provider thinking and ordinary answer copying, with bounded text-layout pieces. The maintained session guide owns that limit. Model resource `/reload` also does not refresh the SDK ModelRuntime: wrapper recreation is required to reliably apply edited definitions; no idle-runtime-refresh port was silently added.

### Retained iteration failures

No test retry was unchanged, deadline raised, original scenario skipped or console/5xx class suppressed. Static and fixture failures were corrected from their exact evidence:

| Evidence | Cause/correction |
| --- | --- |
| `/tmp/pi-web-followups-deps.5qDW5J.log`, `deps-hash.AFgOse.log`, `core.7mWa1D.log`, `deps-final.EH64RU.log` with the common `/tmp/pi-web-followups-` prefix | Deliberate lock/hash realization, including removal of an unnecessary intermediate direct dependency; final npm-cache hash `sha256-o1gi4hxhZbiaoE+nVvKhk6N8uHFoNi4kr+zVzme3Df8=`. First update-shell invocation refused duplicate `/dev/null` user/global config; distinct configuration paths corrected it before lock-only updates. |
| `/tmp/pi-web-followups-core.yCDGx8.log` | Native Node TS test import could not resolve a new extensionless helper; use existing Jiti loading convention in affected tests. |
| `/tmp/pi-web-followups-focused.9hdAru.log` | Old source contract expected hook-owned reducer state; updated to the real store owner while retaining event/entry/anchor assertions. |
| `/tmp/pi-web-followups-focused.BFGFQZ.log` | New VM test double aliased `this`, rejected by lint; record its instance through an array instead. |
| `/tmp/pi-web-followups-checks.ONl3NG/` | CJK href assertion expected decoded text; preserve encoded URL semantics. Scoped Settings navigation removed a duplicate Skills label. Mobile terminal settings used real panel controls rather than clicking through an overlay. |
| `/tmp/pi-web-followups-checks.1fqgiE/` | Streaming fixture omitted SDK assistant snapshot before deltas. Skill selection used its button, not duplicated text. Mobile terminal sidebar closes through actual session selection. |
| `/tmp/pi-web-followups-checks.rUuDOp/markdown.log` | Exact footnote text omitted the rendered backlink; corroborated in retained screenshot, then match the actual footnote content. |
| `/tmp/pi-web-followups-markdown.NuQhc3.log` | Model sidebar displays ID, not friendly model name; select actual ID. |
| `/tmp/pi-web-followups-markdown.2GSTW9.log`, `markdown.x99igK.log` with the same prefix | Mobile Settings uses its native section select and leaves the sidebar open afterward; exercise the corresponding real controls/session row. |

`npm audit --omit=dev --json` retained at `/tmp/pi-web-followups-audit.O4sIa0.json` reports three existing moderate runtime findings (Mammoth/argparse/sprintf-js), no new parser finding; dependency guide retains their dispositions. Audit is not proof of complete security. Production builds/checks ran only inside Nix builders. No live credentials, providers or installed host service were used.

Local `rst-main` advanced during development to `3728eafde511b8c71040db29b7190ec76976f7e2` with Git checkout-role guidance/validation and explicit four/four acceptance guidance. These unrelated changes will be preserved by guarded rebase before full acceptance. Normal full command is `nix run .#test -- all --workers 4 --jobs 4` if admitted; read-only reviewers alone are not a reason to halve it.

### Rebased-candidate verification

- First guarded rebase onto `3728eaf` produced `0335f38eab13010055caafa7a7a0370f6f42ea4d`. At the user's request, rebased again onto new worktree-filter/bulk-move integration target `74554a9d8ef0b9a0c6ecfa831b921ce1c86b5724`. The initial conflict was aborted, original tip/cleanliness verified, and recovery branch `backup/upstream-followups-before-latest-rebase-20261020-144626` retained. A read-only merge preview identified only adjacent `move`/`terminal` documentation rows; the mechanical replay preserved both. Candidate `dd8e20793459cf0801d3bd4a13f4617ca6407571` is clean; range-diff confirms unchanged runtime commits and only the updated documentation context. No semantic conflict or target edit.
- First complete `nix run .#test -- all --workers 4 --jobs 4` failed in **213 seconds command wall time**, including realization: `/tmp/pi-web-followups-all.PI9g7a.log`. Two old `lib/markdown-source-lines.test.mjs` regexes assumed source-coordinate attributes were first on headings; actual output retained the correct coordinates plus the new heading data. The runner honestly stopped remaining coverage and drained peers; no complete acceptance or deployment proof is claimed from this run.
- Corrected assertions require both heading data and exact source coordinates independently of serialization order, and additionally reject forged incoming heading/source attributes. Focused `core --jobs 4 --file lib/markdown-source-lines.test.mjs --file lib/markdown-anchors.test.mjs --file components/FileViewer.probes.test.mjs` passed **3 files / 14 tests / 2 suites** in **41 seconds command wall time**; `/tmp/pi-web-followups-source-lines.YNQjcT.log`, `/tmp/pi-web-test-core.fBJs8f/run.json`. Application inputs were not changed by this correction. Complete fresh four/four acceptance remains pending below.

## Completion Checklist

- [ ] Every requested item is implemented with meaningful focused evidence; any retraction/blocked item is explicitly accepted, not silently omitted.
- [ ] Independent reviews are resolved; complete acceptance passes for the settled candidate and exact identities are recorded.
- [ ] Durable behavior belongs to maintained guides; evidence/temporary decisions are archived only after completion.
- [ ] Verified handoff distinguishes source integration from host deployment/publication; Git receipts own final merge/cleanup results.
