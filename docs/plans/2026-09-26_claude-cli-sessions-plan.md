# First-class Claude Code sessions through the CLI

## Goal

Let a single Pi Web operator create, browse, resume, and interact with local Claude Code sessions in the normal project sidebar and chat UI. Claude Code—not Pi's model runtime—owns the agent loop, tools, conversation files, and authentication. Pi Web owns the browser interface and a separate, explicitly identified Claude CLI transport. Questions and tool approvals must be answerable in the browser without an embedded terminal.

Writing this plan authorizes **no implementation, Claude invocation, account use, or publication**. Execute only after a separate request.

## Plan Relationship

`2026-09-25_browser-ask-user-plan.md` owns Pi's native `ask_user` tool and its web form; this plan can reuse presentation patterns, not Pi tool schemas or transport. `2026-10-18_session-archive-plan.md` owns Pi JSONL archive semantics; Claude transcripts must not acquire Pi-specific entries. `2026-09-25_multi-provider-accounts-plan.md` owns Pi provider credentials; Claude authentication must remain with the unmodified Claude CLI.

## Architecture

- **Boundary:** Add a `claude` session source and namespaced browser/API identity, e.g. `claude:<session-id>`; never send that ID to Pi's `SessionManager`, `startRpcSession()`, or provider-account routes. A source-aware adapter owns Claude discovery, transcript-to-display mapping, commands, and live events. Preserve Pi behavior and avoid treating a Claude model as just another Pi model.
- **Data flow:** browser prompt → source-aware agent route → per-session Claude CLI subprocess launched in the selected validated cwd → Claude NDJSON events → source-aware SSE adapter → existing chat presentation. Use the CLI's documented print/stream-json flags; capture the CLI's real session ID, persist no extra credential material, and serialize turns for each session. Resume a stopped conversation by explicit ID, never by the cwd's ambiguous `--continue`. An externally running interactive Claude process is browse-only unless a supported attachment interface is established; never run competing writers against its transcript.
- **Discovery:** list local Claude conversations through a supported session API or a bounded, read-only adapter if SDK helpers cannot be used under the chosen authentication/policy boundary. Preserve cwd, project/worktree grouping, stable IDs, pagination, and refresh behavior. Do not mutate Claude JSONL for titles, stars, archive, or recovery; store any Pi Web-only metadata separately if needed.
- **Input while a turn is running:** the CLI's permission-prompt host (if verified on the installed version) forwards `AskUserQuestion` and tool-approval requests to server-side pending requests. The browser renders the question/approval, posts one validated answer, and the host returns a decision to the *same running turn*. Reuse Pi Web's question UI patterns without assuming its `ask_user` result format equals Claude's `AskUserQuestion` contract. A plain-language question at the end of a turn is answered with the next normal chat prompt.
- **Ownership and recovery:** source-specific registry/lease owns one subprocess and pending approvals per live Claude session; register listeners before snapshotting for SSE reconnect. On Stop, timeout, disconnect, server restart, or process exit, settle/cancel outstanding requests and distinguish completed, failed, and possibly interrupted turns. Never silently resend a prompt after restart; reconcile transcript before allowing an explicit retry. Scope activity, review markers, search targets, file roots, and recovery records by source.

## Non-Goals

- OAuth token extraction, spoofed client identity, patched Claude binaries, or bypassed permission checks.
- Reusing Pi's provider-account login for Claude, cloud/Remote Control session attachment, or attaching to an independently running CLI turn without a supported transport.
- Exact parity with Pi-only branches, extension tools, tool presets, compaction, export, archive, or subagents on the first release; unsupported controls must be hidden or disabled explicitly.
- Implementing this plan, changing the Pi TUI, or auto-starting paid Claude runs during page load.

## Unknowns and risks

- **Policy gate:** Anthropic's [legal guidance](https://code.claude.com/docs/en/legal-and-compliance) discusses products running an unmodified binary with end-user-owned login but also restricts intermediating subscription credentials/usage. Its [support notice](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) says `claude -p` and third-party usage currently draw on subscription limits. Confirm the proposed product/auth boundary before implementation; neither document alone grants blanket approval. Prefer the user's installed CLI with login handled exclusively by Claude; do not collect or expose credentials. Recheck current terms before shipping.
- **Protocol gate:** installed CLI 2.1.280 advertises `--input-format stream-json`, `--output-format stream-json`, `--include-partial-messages`, `--resume`, and `--permission-prompts host`; the documented `--permission-prompt-tool` is not in this binary's `--help`. Verify the exact input/event schemas and whether headless `AskUserQuestion` reaches the host and resumes on an answer. Reports differ; fail the gate rather than substitute unsafe blanket approval. A live protocol spike consumes subscription/API usage and needs explicit authorization and a small budget.
- **Security:** `claude -p` skips the workspace trust dialog and may load project hooks/MCP configuration. Restrict launch to already authorized/trusted working directories, expose the trust consequence clearly, keep defaults conservative, and retain the existing filesystem containment boundary. Never use `--dangerously-skip-permissions` as a compatibility fallback.
- **Compatibility and cost:** CLI output and session metadata can evolve independently of Pi Web; pin a tested minimum version, feature-detect optional flags, cap stdout/stderr buffering, and surface parse/auth/rate-limit failures. Avoid double-rendering partial and complete assistant messages or leaking internal system/tool data in SSE.

## Plan

- [ ] Record a bounded policy/product decision for end-user-installed, unmodified Claude CLI execution and credential ownership in `docs/adr/`; review the linked official guidance and obtain explicit acceptance of any remaining distribution risk before implementation.
- [ ] Build a disposable, isolated CLI protocol spike outside production routes: prove two prompts in one process, streamed text/tool-result correlation, explicit-ID resume after exit, abort, and process-error behavior; save redacted fixture events and focused parser tests. Ask the user before any paid/live invocation and record CLI version, exact commands, result, and usage; do not open credential stores.
- [ ] Extend the spike with a user-approved `AskUserQuestion` and an unapproved tool request: verify the documented permission-host path, validate question/answer and allow/deny round-trips on the installed CLI, and prove cancellation unblocks the process. If it fails, record an explicit design decision and stop native-chat work rather than defaulting to unrestricted tools.
- [ ] Define a typed source/capability contract in `lib/types.ts` and a source-aware route adapter; verify that Claude IDs cannot enter Pi `SessionManager` or `startRpcSession()` and that existing Pi session IDs, responses, and tests remain unchanged.
- [ ] Implement source-scoped Claude session discovery and read-only transcript projection, merging rows at `app/api/sessions/route.ts` and dispatching `app/api/sessions/[id]/route.ts`; unit-test title/cwd mapping, message/tool pairing, partial files, ID collisions, pagination, project/worktree grouping, and safe behavior for active external sessions.
- [ ] Implement a Claude subprocess/session manager and source-aware `app/api/agent/new`, `app/api/agent/[id]`, and events routing; test per-session turn serialization, new/resume IDs, streaming de-duplication, Stop, nonzero exit, bounded output, SSE reconnect, and resource teardown with a deterministic fake CLI—no paid model calls in routine tests.
- [ ] Bridge CLI permission and `AskUserQuestion` requests to server-owned pending requests and browser answer/approval UI; test malformed/late/duplicate answers, multi-select and free text, denial, tab reconnect, browser absence, Stop, timeout, and process crash without granting permission by default. Run a user-approved live question round-trip before marking this task complete.
- [ ] Make `components/ChatWindow.tsx`, `hooks/useAgentSession.ts`, and `components/SessionSidebar.tsx` source/capability-aware; verify ordinary prompt/follow-up, question dialog, live status, model display, and disabled Pi-only controls in focused browser flows on desktop and mobile.
- [ ] Extend source-aware running/activity/recovery/search and file-root authorization only for the intended Claude capabilities; test process-restart uncertainty, no automatic resend, stable project identity, search navigation, and denial of unauthorized cwd/file access. Leave unsupported actions visibly unavailable rather than applying Pi mutations to Claude files.
- [ ] Document installation/version detection, end-user CLI login boundary, trusted-cwd behavior, supported/unsupported controls, restart/recovery, CLI upgrades, and cost implications in `README.md` and the relevant focused guide; review the user-facing copy and update the ADR if the validated design differs.
- [ ] Verify the exact implementation candidate with focused parser/process/API tests, `npm test`, `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `npm run test:e2e` for browser flows; run `npm run test:terminal` only if terminal integration is changed. Never run a production build during normal development. Obtain an explicit user-approved live CLI acceptance pass for question/approval/resume behavior, then request separate exact-state approval before the required local non-fast-forward integration into `rst-main`.

## Rollback / Recovery

Keep Claude's own transcripts and auth untouched. Disable the Claude backend or remove its Pi Web-only metadata without deleting Claude sessions. On process failure/restart, terminate or release managed children, cancel outstanding approvals, mark uncertain runs for review, and never replay a prompt automatically. A schema change in Pi Web metadata needs a versioned, reversible reader; no direct migrations of `~/.claude` files. Do not clean up the feature worktree, integrate, or publish without the separate lifecycle approvals.

## Completion Checklist

- [ ] The policy/protocol gates have recorded results; native chat does not ship if an interactive question and approval cannot complete safely on the supported CLI.
- [ ] New and resumed Claude sessions render, stream, stop, and recover in the normal Pi Web chat without mutating Pi or Claude transcript formats; fake-CLI tests and an explicitly approved live acceptance run provide evidence.
- [ ] Question/approval dialogs continue the same Claude turn and fail closed on cancellation, disconnect, and invalid answers; focused API/browser tests and the approved live run pass.
- [ ] Pi sessions and security boundaries remain intact; relevant focused tests, `npm test`, typecheck, lint, browser e2e, and conditional terminal checks pass or have explicit disposition.
- [ ] Current behavior and limitations live in maintained documentation/ADR; exact-state local integration has its own approval, and remote publication remains unrequested.
