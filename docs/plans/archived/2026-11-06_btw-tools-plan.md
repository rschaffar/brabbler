# Tool-enabled BTW conversations

## Goal

Make BTW an ordinary, independently configurable session presented beside its source, with tools, skills, trusted extensions, delegation and selected native resources. User authorization covers implementation and local integration through the repository's normal gates; deployment and publication are not authorized.

## Plan Relationship

Supersedes the chat-only capability choice in the archived BTW implementation plan. Existing family identity, snapshots, source-card isolation and no automatic source turn/report remain unchanged. Native tools, session launch and Git policies keep their existing owners. No active plan owns this change.

## Architecture

- New BTW sessions snapshot the source's built-in tool and native-resource selections, alongside existing model/account preferences. Existing saved selections, including Chat only, remain authoritative and become editable.
- Normal startup/resource loading and APIs apply to BTW. Additive guidance identifies the source reference as historical data, not delegated work or approval authority.
- A bounded, read-only source-context tool pages through the source branch anchored by the child's saved reference. No model-supplied source identity, source navigation, question response or automatic handoff.
- Normal tool/native-resource controls are available in the panel and full-size chat. Source and BTW share the working directory; guidance requires coordinating writers.

## Non-Goals

Nested BTW UI, automatic source actions, copied approvals/session overrides, new trust grants, OAuth/configuration management, deployment and remote operations.

## Plan

- [x] Implement ordinary BTW capability loading, inherited initial selections and additive guidance; retain explicit Chat-only selection and cold-reopen behavior.
- [x] Add source-context paging and expose ordinary controls; verify independent question/approval behavior and source immutability.
- [x] Update focused runtime, mounted and installed-browser owners and maintained guides. Replace obsolete chat-only assertions with positive capability coverage; retain all unrelated scenarios and inputs.
- [x] Run focused static/core and running-forks acceptance, independent safety review, then complete Nix core/browser/terminal/deployment acceptance on settled source.
- [x] Prepare the reviewed diff and verification evidence for the native commit/rebase/exact-state non-fast-forward integration handoff. Native operation cards and durable receipts own approval and actual Git effects; this implementation plan does not certify an unperformed merge.

## Risks and Recovery

Loaded extensions have normal host permissions, not a sandbox. Source and BTW can write the same checkout, so ordinary worktree/writer coordination remains necessary. Persisted empty selections are not silently widened. Missing selected native declarations/accounts fail closed under existing policy. Retain histories and failed-run evidence; no automatic tool replay, source response or session deletion. Reverting code restores the former BTW policy without rewriting conversations.

## Verification

Primary owners: `lib/btw.test.mjs`, `lib/btw-runtime.test.mjs`, `components/ChatWindow.btw.test.mjs`; installed bridge: `running-forks` at its existing desktop/mobile inputs. Complete acceptance uses `nix run .#test -- all --workers 4 --jobs 12` if resource admission permits overlap, otherwise the documented four/four fallback. Evidence must distinguish focused checks from full acceptance and record immutable input, result, wall/preparation/execution intervals and private artifact location without personal paths here.

## Implementation checkpoint

Ordinary capability loading, editable controls, additive guidance and source paging are implemented. Independent review identified and resolved persistent SDK opening of cold sources, native-dialog Escape ownership, extension-only sources accidentally becoming Chat only, and unstable v1 anchors. Cold inspection now uses a non-writing descriptor; pre-tree v1 sources require explicit ordinary reopen/upgrade.

Focused intermediate verification passed static checks and 111 tests across the five selected core files. A deliberate private source-opening fault failed the exact legacy-source byte-identity assertion; the restored source passed. The first native route regression caught the remaining forced-empty GET projection, which was corrected. Initial source-reader static failures (BigInt literals versus the existing TS target and optional header version) were fixed, not counted as meaningful runtime reds.

The installed desktop/mobile bridge first passed a genuine read-tool round-trip with the source question/drafts untouched. Expanded desktop checks passed modal Escape, explicit Chat-only/enable replacement and native Apply. A subsequent mobile pre-BTW assertion exposed stale cross-call geometry after More blurred the editor: retained trace frames show keyboard-aware viewport expansion between measurement and hit-test. The bounded correction measures/hit-tests atomically, retaining the same assertion/deadline under a fresh mobile receipt. No test steps/inputs are dropped; only obsolete no-tools expectations are replaced. The first complete run passed the expanded desktop/mobile BTW chain, then stopped at 399/528 core files on an obsolete source-reference architecture assertion that prohibited host references in BTW. That assertion now requires the ordinary inert explicit-link handler in both ordinary and BTW sessions while retaining user-extension suppression for Chat only. The 347-second interrupted full attempt is retained as incomplete evidence, not acceptance. Complete settled-source acceptance subsequently passed as recorded below.

## Settled acceptance and handoff

`nix run .#test -- all --workers 4 --jobs 4` passed on immutable source `/nix/store/9ly26ya3i155q97y8vpvwcqrhbscrgm4-source`, content/mode digest `7471fd35ed927d51eac28fea95ad125d50c14f697e1d562824120e27edf0c146`. Application package: `ckh5nn2w8c872g9dbh98zi3ynlwvjzmy-brabbler-0.1.0`. Requested/effective core and browser widths were four/four, with overlap admitted on 32 CPUs and about 42 GiB available RAM; the 43 GiB twelve/four estimate did not have sufficient headroom.

- Core/static/plugin: 528/528 files, 4,483/4,483 tests and 14 suites; no skips/cancellations. Matching typegen/tsc evidence was reused; lint passed with zero errors and eight existing unrelated warnings.
- Browser/terminal: all 26 groups passed, including the expanded BTW read-tool, modal/bare Escape, same-ID Chat-only/enable and native Apply chains at both original inputs.
- Genuine Home Manager deployment VM: passed activation, persistence/restart, PTY and shutdown checks. This is not deployment to the host service.
- Whole command: 563 seconds, including in-run realization. Core invocation 557.721s, pre-lifecycle setup/static/realization envelope 57.151s, lifecycle 500.292s and test-file window 498.870s. Browser invocation 290.858s, support/manifest preparation 3.764s/4.723s and group-client window 282.367s. Deployment invocation 82.698s includes realization and VM execution. These overlapping intervals are not additive; earlier attempts prepared package/type prerequisites, so no cold-cache or speedup claim is made.

Independent read-only review resolved all concrete blockers. The private task record retains exact report/log paths, failed attempts, source-opening fault evidence, viewport trace frames and `results/verification-summary.json`. Runner-owned automatic report roots retain their supported layout; wrapper logs/source exports use the private task directory. Only this plan's status/archive changes follow the accepted snapshot; application and test bytes remain unchanged. Maintained behavior lives in ADR 0041 and the feature/session/native-tool guides. Git commit/rebase/merge outcomes belong to the separately gated native handoff; deployment, publication and cleanup of private evidence are not implied.

## Completion Checklist

- [x] New BTW can call ordinary tools; existing BTW can enable them without losing identity/history.
- [x] Chat-only opt-out, account/trust/permission isolation, source snapshot and source-card boundaries remain intact.
- [x] Focused and complete acceptance pass, and independent review has no unresolved blocking findings.
- [x] Maintained documentation matches the delivered behavior; verified exact-state local integration handoff is ready for its native approval/receipt.
