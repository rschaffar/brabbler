# Request-header and transcript file-reference security boundaries

## Decision

Reject externally supplied Next revalidation headers before framework request dispatch. Narrow session-derived external-file authorization to explicit conversation and coding-tool reference sources. These fixes do not rewrite session data, credentials or immutable build artifacts.

## Early request guard

Pinned Next 16.4.2 skips middleware/proxy when `x-prerender-revalidate` matches the build preview ID. The distributed `.next` contains that ID, so it is not an authentication secret. Authentication in `proxy.ts` must not be bypassable by knowledge of a build artifact.

`bin/request-header-guard.js` installs an idempotent, process-local wrapper on HTTP and HTTPS server `emit` methods before Next loads. It rejects either `x-prerender-revalidate` or `x-prerender-revalidate-if-generated` by **presence**, independent of value, case or duplicates. Guarded `request`, `checkContinue`, `checkExpectation`, `upgrade` and `connect` dispatch never reaches framework listeners. Ordinary events retain their arguments, receiver and return/error semantics. This intentionally intercepts server dispatch, not EventEmitter globally: prepending a listener alone would not stop later listeners.

Guard-generated denials are 400, no-store and connection-closing, without logging header values. Upgraded/CONNECT sockets flush the denial and then destroy both halves, even if a peer withholds EOF. Node's own HTTP parser/Expect handling can reject earlier; unsupported expectations without a handler receive Node's 417, and Node may send 100 Continue before dispatching a request. Neither case permits application dispatch. This is not a claim that all malformed HTTP receives the guard's headers/status.

The installed launcher passes an absolute `--require` path through `getNextNodeArgs`, retaining the RISC-V flag and existing Next CLI/process lifecycle. The four root npm dev/start scripts use `bin/next-cli.js`, which loads the guard before Next and puts its absolute preload path in `process.execArgv`. Next 16.4.2 reconstructs dev-worker NODE_OPTIONS from those options, preserving the preload for replacement workers; regressions exercise that actual formatter and new Node processes. No custom server, reverse-proxy dependency, preview-ID extraction, startup manifest rewrite, unsafe store permission or warn-and-continue rotation is introduced.

Direct invocation of the dependency's bare `next` executable, arbitrary custom servers/embedders and standalone output launched outside these entrypoints are **not protected by this launch boundary**. They are not supported serving entrypoints for this application. An independent external authentication proxy remains useful defense in depth, not a prerequisite for this fix. Reassess this adapter and its propagation tests on Node/Next upgrades.

## External file references

Normal file-root authorization remains centralized in `lib/path-security.ts`. Session references are a deliberately narrower, read-only exception for exact external files, not directory browsing, editing, uploads or saves.

`lib/session-file-references-core.ts` explicitly extracts:

- User/assistant text, including legacy string content and intentional Markdown/file/source-location links.
- Known path fields in recognized coding calls, shell command text, explicit Agent input files and patch operation paths. Raw SDK and normalized call shapes are supported. Exact plain/`functions.*` coding/subagent aliases are used, never broad UI prefix/suffix heuristics.
- Text from recognized coding/subagent results; documented bash/powershell `details.fullOutputPath`, and user shell execution output/full-output paths. SDK 1.3 `nestedCalls.calls` contributes only recognized coding-call arguments, never remote result/error text or arbitrary nested objects.
- Text in schema-checked host `pi-web:subagent-notification` reports, not their worktree/error/description metadata.

System prompts/tool definitions, thinking/images/signatures, model/error metadata, context edits, summaries, labels, generic custom messages/stores, and operation/interaction receipt data are not grants. Missing legacy result names can derive identity only from a matching ancestor call; conflicting identities reject, and sibling branches cannot lend authority.

Literal path fields use filesystem-path equality through `samePath`. They are never URI-decoded, substring-matched or stripped of fragment/source-location suffixes. Textual conversation links retain those navigation conventions. Session-wide historical references remain intentional because current file requests carry `sessionId`, not a viewed leaf; an active-branch-only model would require a separate API/UI contract.

## Viewer probe eligibility

File-read responses provide advisory edit/Git probe eligibility from the existing root checks, independently of session-reference read authority. Reference-only files advertise neither probe; a validated viewer cwd may narrow Git eligibility but never grant read authority. Missing root-authorized files can retain Git eligibility through a surviving physical ancestor, preserving deleted-subtree diffs. The client gates automatic probes and stale watcher continuations; edit/save/Git endpoints remain authoritative. No roots are added and no browser error class is suppressed.

## Limits and consequences

Recognized coding-tool result text can itself contain untrusted file/shell output. Retaining it is a compatibility decision, not a general prompt-injection or data-exfiltration solution. Deliberate assistant/user references still grant access; untrusted text copied into those sources may therefore become a reference. Extensions execute with process authority and are not sandboxed by this policy. Generic external-reference reads retain their pre-existing symlink/replacement behavior; this change does not introduce a no-follow file-descriptor boundary for them.

Opaque incidental historical references may stop opening; an intentional user/assistant link or explicit authorized root restores legitimate access rather than restoring blanket transcript authority. No migration is required. Existing running processes acquire neither fix until the updated package is deployed/restarted through a supported entrypoint; source integration does not authorize that host operation.

## Verification

Core regressions cover HTTP/HTTPS dispatch, synthetic protected processors, duplicate/empty headers, Expect/native rejection, upgraded socket settlement, launcher/RISC-V/npm/dev-worker propagation, explicit reference sources, literal-path identity, branch attribution and real route denial before filesystem work. Packaged state acceptance checks actual launcher header rejection without reading preview secrets. Packaged Markdown acceptance uses UUID sessions and safe sentinel files proven outside all admitted roots, exercising real reads/denials and interactive read-only source-link navigation. It verifies watcher updates/tab reopening issue no forbidden edit/Git probes, Edit/Save controls stay absent, direct refusals remain intact and no new file root is admitted. The harness keeps unfiltered console errors. Complete acceptance and retained evidence follow [Testing](../testing.md).
