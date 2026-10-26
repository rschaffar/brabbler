# Complete behavioral test ownership — execution plan

> **Implementation resumed by explicit user request in the current session.**
> Authorization covers implementation, coordinated checks and reviewable feature
> commits only. No rebase, merge, resource cleanup, publication or ordinary-session
> launch is authorized. The handoff's historical default pause was superseded for
> this session only. **Bounded decision: finish WP2 browser retirement first.**
> **Latest user decision:** stop optional proof expansion and finish browser
> retirement. Performance targets are informational, NOT a hard completion gate;
> core/RPC/cache optimization remains a separate later task. Complete correctness
> acceptance remains required. No matched timing rerun or performance tuning here.

## Goal

Deliver ownership and browser retirement with complete correctness evidence.
Track the original performance targets separately, without blocking this finish:

1. Finish original 68 and named added obligations using the lowest sufficient **real
   production** owner, not copied algorithms, fake React or detached cleanup claims.
2. Actually remove redundant Chromium execution, setup, navigation, transactions,
   reloads and waits. Retain only justified physical/native/thin installed bridges.
3. Demonstrate faster **complete feedback**, not just focused speed or more tests:
   matched sequential 4-browser/4-core runs, NET improvement, complete command
   ≤351.05s and Panel median ≤20.5s. These original targets are now deferred,
   informational measurements, not acceptance gates for this bounded task.

**Decision:** materially replan execution, preserving the architecture and safety
contracts. See [reflection](2026-10-23_complete-test-ownership-reflection.md) and
[paste-ready handoff](2026-10-23_complete-test-ownership-handoff.md).

## Authority and working state

- Use existing linked checkout
  `/home/robert/projects/3rdparty/pi-desk-worktrees/complete-test-ownership`, branch
  `refactor/complete-test-ownership`; resumed HEAD
  `53fc2e6502d2debc4741a13bc9736d0536949d11`. Checkout/branch/HEAD, empty index,
  operation state and live Git policy were validated before mutation. All 56
  inherited dirty/untracked implementation files matched their retained original
  hashes; exact bytes are additionally preserved in `R/resumed-implementation/initial`.
  Preserve all existing work and retained resources. Coherent source commit:
  `c694c01405ead47d97ba0adfdf68f867e4af512d`; subsequent evidence-only documentation
  does not change the tested application/test inputs. Branch/worktree remain
  unintegrated; no rebase, cleanup, publication or ordinary-session launch occurred.
- [Testing](../testing.md), [Writing tests](../test-writing.md),
  [browser acceptance](../../e2e/README.md), ADR0034 and applicable product guides
  remain owning contracts. No new framework/backend/runner or acceptance fallback.
- Evidence root **R** is `/home/robert/.cache/pi-web-complete-ownership/run.VpOwBo`.
  The [pause record](/home/robert/.cache/pi-web-complete-ownership/run.VpOwBo/PAUSE-HANDOFF.md)
  owns historical lineage/delegate outcomes; this plan alone owns next-work status.
- The original untracked 674-line plan is preserved byte-for-byte in
  [the pre-replan evidence](/home/robert/.cache/pi-web-complete-ownership/run.VpOwBo/documentation-replan/before/docs/plans/2026-10-23_complete-test-ownership-plan.md).
  It is a superseded revision, **not** an archived completed plan. The
  [original 68 census](../test-ownership.md) is baseline inventory, not a new backlog.
  Reuse the existing [finite original-input review](/home/robert/.cache/pi-web-complete-ownership/run.VpOwBo/final-68-retirement-input-review/report.md);
  its scope does not close the later surviving-step browser audit.

## Evidence and verification state

| State | Authoritative evidence / limit |
| --- | --- |
| **Verified receiving-baseline early whole correctness; ceiling FAILED** | `R/resumed-implementation/early-all-analysis.json`: fresh `nix run .#test -- all --workers 4 --jobs 4`, source digest `6873c082fc4d1a4e403fa3464b9d181d15efac86c0492be2e2454309ec572b0b`; **508 files /4143 tests /14 suites**, all26 browser/terminal groups and genuine VM pass. Command **398.058438374s**, core file window **388.662s** alone exceeds351.05 by37.612s. This is not a matched NET comparison or final task completion. |
| **Verified, historical full correctness; performance FAILED** | [Matched full timing](/home/robert/.cache/pi-web-complete-ownership/run.VpOwBo/matched-first-critical-path.json): 421.959333907→430.231565s, +8.272231s; candidate 79.181565s above ceiling. Both roots already have the middle layer. Core 415.258→422.398s dominates; browser 348.749→347.310s. No later full pair supersedes it. |
| **Verified, finite private compositions** | [Coherent Sixth](/home/robert/.cache/pi-web-complete-ownership/run.VpOwBo/browser-retirement-v2-coherent-sixth-composition/RAW-EXECUTED-FIRST.json): 42 files / 571 tests / 85s and 11 affected installed receipts. [Thinking/Tool](/home/robert/.cache/pi-web-complete-ownership/run.VpOwBo/browser-retirement-v2-thinking-tool-composition/RAW-EXECUTED-FIRST.json): combined24 and six producer faults; restored60 files / 806 tests / 104s. Focused, not current whole acceptance. |
| **Verified latest lower subset, receiving impact still open** | [Navigation Fourth binding](/home/robert/.cache/pi-web-complete-ownership/run.VpOwBo/browser-retirement-v2-navigation-default-composition/FOURTH-BINDING.json) plus `R/browser-v2-navigation-default-owners-4.*`: 26 green / 44s. Optional explicit composerDraftKey fixture port has not rerun its shared pool or three producer faults. |
| **Verified receiving lifetime slice, not whole acceptance** | `R/resumed-wp1-receiving-2.*`: exact27 files /173 tests GREEN51s, including unchanged Save200/409. Latest three-file normal/restored runs cover21 cases (including actual partial leaf installation failure and sole HOST observation). Unconditional-unmount regression fails both original Save premises; omitted leaf rollback fails both actual descriptor/partial-install assertions. Exact logs/hashes: `R/resumed-implementation/lifetime-regressions.json`. Review corrected an additional HOST collector-order gap. Initial receiving run and unsuccessful diagnostic attempts remain retained; no unchanged-failure retry is credited. |
| **Verified finite Thinking retirement, not whole acceptance** | `R/resumed-implementation/thinking-browser-result.json`: original-work15 has normal13 plus both expected REDs reaching terminal SAME-error/full-tail/phase assertions42s; restored13+protocol4 =131 GREEN44s. Fresh installed History bothv4 receipts GREEN50s/capsule38.073s. Three deferred reads/waits become one per original LD/LM: four actual GET/body/wait transactions and the unused request listener leave Chromium. Tool/composer/version/native neighbors stay unchanged. |
| **Verified finite Tool retirement, not whole acceptance** | `R/resumed-implementation/tool-browser-result.json`: two actual Copy peers remain pending across real unmount; original primary and preceding registered-hook failure survive independent release/joins; full handlers/observations settle before actual close. Late-observer mutant fails explicit0-vs1 after settlement; old try/finally font-restore mutant fails both same-error tests. Current6-file145 GREEN; fresh installed bothv5 receipts GREEN45s/capsule33.312s. Two extra pages/navigations, four state-route registrations, synthetic SSE journeys, eleven repeated successful Copy/wait/read actions, two forced-refusal phases and unused nested seed pair actually leave Chromium. |
| **Verified finite Composer retirement, not whole acceptance** | `R/resumed-implementation/composer-browser-result.json`: five list loops, false-exec setup/override/restoration, synthetic composition and option-count replay leave BOTH original profiles. Initial native normal failed honestly: actual trace shows last exact interceptor removal auto-continued a pending original model Route before its fulfill. Releases now precede captured work joins, then independent exact removal; no error suppression. Current protocol122 GREEN40s; two original native after-success strict expected REDs21/17s; both normal and restoredv6 profiles GREEN45/42s (restored capsule32.820s). Native undo/redo, selection, keyboard/IME geometry, manifest, SPA draft and unchanged P1 retained. |
| **Verified finite Web/version retirement, not whole acceptance** | `R/resumed-implementation/web-version-browser-result.json`: paused authored case executed directly under current18-prefix/support guards, no new source-only packet. Actual unknown native Node JSON E captured before original check catch, independent P, full known originals/descendants, SAME `[P,body(E),actualFixture(E)]`, Realm-before-emulated-close/Host-after and next real mount reach terminal vector;18 normal+1 intended RED38s. Restored normal/current protocol140 GREEN40s. Exact already-qualified native9ff stage reused, not recoded/retested matrix; sparse LD guard removes LM second version context/page/goto/read/Cancel/Accept/reload/disposal. Both freshv7 receipts GREEN43s/capsule31.419s; only LD version stage executes. |
| **Verified finite Navigation retirement, not whole acceptance** | `R/resumed-implementation/navigation-browser-result.json`: current two corrected actual-owner cases/common explicit optional input prop pass26; three independent actual producer defects reach stale-row false, scroll1400-vs20 and lost literal41/41/42s, all restored. Exact existing60-file impact/restoration814 GREEN104s (pre-native snapshot, not relabelled). New finite native branch port keeps real SDK current context/UI and original inert agent reply, separates original callback/e32/native/ACK/body, retains actual errors/removal/close/restoration. Both strict after-success body/UI and raw/UI controls27/28s reach all50 known rows and SAME cause trees before intended REDs; current149 GREEN40s and both native normal/restored LDv8+unchangedLMv7 GREEN44/41s. Desktop controlled context gate/route/pending wait/release/no-op catch really leave Chromium. Saved AppShell caller/P1/M16 remain. |
| **Verified finite Files upload retirement, not whole acceptance** | `R/resumed-implementation/files-upload-browser-result.json`:11 actual producer faults reach semantic witnesses with all20 completed; three first opaque observations remain uncredited. Matcher/callback SAME-error capture, admitted-load join and scalar projection diagnostics repair only the receiving tests/support. Existing receiving27/shared60 union82/940/2suites GREEN137s; exact current7/144 GREEN40s. Five real-native after-success v2 controls join original native/helper/ACK work and actual page/trace/context/fixture closure before SAME-root rethrow; final artifacts contain only the intended error, no completed receipts and bounded owned-resource settlement. Initial v1 late-shutdown contamination and wrong index-refresh premise stay retained/uncredited. Both v4 native profiles normal/restored GREEN48/44s (restored capsule32.706s). Seven upload round trips per profile, related picker/list/wait replay and mobile duplicate denials leave; actual Changed/Search callers, external writer, one overwrite/watch bridge and all M16/P1 remain. |
| **Verified finite Git desktop reader, B6 still partial** | `R/resumed-implementation/git-reader-browser-result.json`: exact original desktop5000-line tuple reaches real parent/Pierre cache, both named rows, renderer recreation, versions/query/position, collapse and serialized remount/409/current response. Three supplied public-binding errors, actual queued renderer frame and jsdom's missing scroll notification were corrected only in receiving test code. Two actual producer defects reach intended scalar failures; first typed-model proposal failed static checks and remains uncredited. One strict held-transport/loader-finally P/E/C schedule reaches104 parent originals/107 tails and SAME cleanup roots after actual jsdom/descriptor/HOST restoration; Abort/action ACK is not loader completion or already-admitted JSON. Current126 GREEN47s; both installed definitions normal/restored GREEN55/56s (restored capsule42.483s). Only ED cached-reader replay leaves Chromium; LM/full matrix, both cold native bodies, history/Download and policy/large subjects remain. No unpaired native02/03 append or optional cross-cancel cut. |
| **Verified finite selected-policy cancellation, B6 still partial** | `R/resumed-implementation/git-policy-browser-result.json`: exact native02 owns both original selected Ask/PWD/caller-Deny/current-origin/cancellation inputs. Existing RPC and mounted Source cases gain phases without losing original confirm/Stop/receipt tuples or adding SDK startup/fixtures. Five actual defects reach caller-Allow wrong abort, selected-Deny missing abort, dropped plugin signal, matching close failure and independent aborted-receipt failure; all originals settle. Normal107 and post-mutant current234 GREEN80s; the subsequent same-source both-v4 installed run GREEN48s/capsule36.329s already supplies restored native execution. No duplicate unchanged run is relabelled. Reduced helpers remove one cross-cancel attempt/card/poll chain plus caller-Allow PATCH per input; actual selected-Deny PATCH, caller reset, both HEAD guards and both installed cross-approve subjects remain. Qualified contracts compose; this is not native02's actual signal travelling through an installed SDK session. |
| **Verified finite mobile live-reader retirement, B6 still partial** | `R/resumed-implementation/git-mobile-reader-browser-result.json`: a second data row in the same physical Card/Pierre owner preserves original390 before5000/Allow1280 markers and modified second-draft→reconnect390; desktop evaluated inputs remain unchanged. Two actual390-only producer defects fail retained After/model and named second-file unmount only AFTER all desktop stages pass (40/42s, complete1/1 semantic RED each). Post-mutant current127 GREEN43s and both fresh v5 native GREEN46s/capsule34.638s share the exact five changed input bytes. The mobile cached view/version/query/collapse replay is retired, but BOTH original inline drawer filter/selection/close ceremonies plus Previous/Next remain on the original native session/review. Both cold bodies, opaque UUID/method, shared HEAD/tree/order, fullscreen900/Wide/focus/history/Download and physical approvals remain. Prior exceptional desktop work is not relabelled mobile execution. The private recording SyntaxError is documented, not credited as a semantic failure. |
| **Verified finite Activity Toolbar retirement (046e932 checkpoint)** | `R/resumed-implementation/activity-toolbar-browser-result.json`: exact actual family/badge helper append ONLY (source-only architecture/Restore additions excluded); two actual helper producer defects qualify idle/registry scope. The existing genuine S stage's final reload now owns original application catalogue/running JSON/full continuations, exact returned three-child family and terminal records, actual default Toolbar label/title/span3, with normal unmount/delete/shutdown independently preserved. AT-FORWARD changes only that native family's real AppShell count prop: actual1≠3 reaches strict `[4,3,6,2,6,"1","3",0,0,true]`; private page/trace/context/fixture close precedes backend failure, outer artifact has only intended error. First private preflight missing-import ReferenceError89s is retained/uncredited, not an unchanged retry. Post-mutant post-cut current129 GREEN40s, all three original native profiles GREEN106s/capsule94.648s, same six changed input bytes. ONLY eight synthetic false/idle3/true/wake/next-poll lines retire; original native stats/four IDs/no-ACK/physical metrics/S/P/X/Pause/Acceptance remain. No new SDK/session/request/reload/wake or queue-finally/global-idle/NET claim. |
| **Implemented but unverified / conditional** | Remaining own Cancel/Allow, Git historical/large conjunctions and Activity New/public-composer/default-overview restoration remain private/open. The historical experimental version LM cut executed both receipts52s/protocol11839s before qualification; current v7 composition has its own verified row above. Exact paths/limits remain in the pause record. |
| **Partial or proposed** | Git policy/large remedy: no deliverable. Do not restart stopped tasks automatically or mark proposals implemented. |
| **Abandoned / excluded** | Unsafe timestamp4→2 and speed4→3 cuts, copied-error acceptance, unsupported fixture assumptions and false failed-body/native-closure claims. Deferred RPC/cache/packing proposals are not adopted or authorized next work. Preserve their failures; do not revive automatically. |

## Preserved boundaries

- For **each retained browser step/input**, name the failure its verified lower
  owner plus thin bridge cannot catch. One native step never retains its entire
  journey. Historical 26/59 counts are not quotas; unknown ownership is a finite gap.
- Preserve original height/locale/touch/default/storage, session/cwd/source and
  incarnation/authority inputs. Retain real geometry/scroll/fonts/media, focus/
  selection/keyboard/IME/clipboard/upload/download and installed restoration.
- Protect P1 same-document History receiving, **all six M16 same-node/native
  Save-watcher checks**, and independently admitted Acceptance work (ADR0031).
- Own original complete work/body/catch/finally/descendants separately from external
  ACK and native settlement. Preserve SAME original errors, including unknown and
  cleanup causes; independently attempt releases/joins/removals after failure.
  Restore REALM capabilities before destruction and HOST afterward. Terminal
  release must not invalidate a deliberately held-work observer-unmount input.
- Preserve Activity 2500ms and privacy/recovery 15000ms cadence and original
  API/error/retry/cancel policy. Only the previously authorized Terminal obsolete-SSE,
  SSH saved-alert and role-prefixed account/tools-key corrections are in scope;
  no fourth policy fix. Passive seams preserve original promises/default behavior.
- Keep public `core|e2e|service|all`, pinned Nix Node24.21.0, Chromium/PTY and genuine
  Home Manager VM. No worker/deadline inflation, E-first/group mixing, sleep-as-join,
  warning suppression, cached native authority or weakening of exporter guards.

## Finite blockers

| ID | Remaining blocker | Decisive closure evidence |
| --- | --- | --- |
| B1 | Receiving composition and finite surviving-browser dispositions closed | Coherent source commit `c694c014`, exact guarded adoption and original-input map index in `docs/test-ownership.md`; both Thinking/Copy lanes, Settings18, inherited work/guidance preserved. Final509/4171/14-suites, all26 browser/terminal groups and real deployment VM supply coherent current acceptance. Final B3–B7 cuts and named native bridges are closed; no new68 census. |
| B2 | Receiving lifetime residues and finite smaller upload cut closed | Original Save200/409, eight-descriptor/partial-install/HOST lifetime evidence remains. Eleven actual producer controls now reach intended scalar/matcher/callback primitives; current common diagnostic support passes existing82-file/940 shared union. Five strict v2 native continuations independently join native body/work/ACK and real page/trace/context/fixture closure before SAME-root throw; late v1 shutdown errors remain uncredited, not filtered. Current7/144 normal and both v4 native restorations pass. Actual Changed/Search callers, external writer, all six M16 native/same-node watcher inputs and P1 remain. Successful native closure around finite continuations is not failed-IO/close or universal-idle proof. |
| B3 | Thinking, Tool and Web finite gates closed | Current normal, meaningful original-work failures, restoration, independent review and actual installed work retirement qualify these named slices. Tool's false-green catch/font masking and composer's concrete native removal-order bug were corrected without product-policy changes. Existing Web authored schedule executes strict actual P/E/full-work/cleanup/phase/next-mount vector; no stopped delegate restarted or new source-only packet. Exact native version port reused and LM duplicate removed under fresh v7 receipts. SAME errors, work/ACK/native settlement and unforced limits remain distinct. |
| B4 | Finite native composer remedy/composite03 deletion closed | Exact guards/lower68/312/six semantic defects reused, not rediscovered. Initial native failure retained and concrete Playwright auto-continue ordering fixed; source-only review was not native admission. Current normal and restored BOTH profiles pass; original native V1/V2 pass strict SAME-reference phase/cause-tree assertions then rethrow intended failures, with private owning metadata and zero normal completions. Current normal rejects private/superseded IDs before callbacks. P1/e32/imported native helper/overflow preserved; no failed-native-phase or universal-idle claim. |
| B5 | Finite Navigation optional-port/lower/native branch cut closed | Current26 normal, all3 meaningful actual producer faults, exact reused60/814 restored impact, current149 protocol and original native body/UI+raw/UI strict controls/normal/restoration qualify this slice. Original current11-case prefix including held Copy remains exact. Desktop context-gate replay removed; AppShell saved-key native caller remains. SDK context read versus inert controlled agent reply, native body/ACK versus lower full hook promise, and after-success versus actual native-failure limits remain explicit. |
| B6 | Finite Git retirements and final full correctness qualified | Prior ED/mobile reader and B-P evidence remain unchanged. Own Cancel adds original selected-file/mode/native live-null/builtin-Ask own-session/full-origin/no-effect rows, actual inline public Card→real hook SAME callback promise, and actual normal RPC cancelled-response→null receiver (not abort default). Nine meaningful producer controls plus two controlled FETCH failures after real root unmount qualify both input replays; first wrong abort-default mutant survived and first JSON/hook-catch oracle failed, both retained/uncredited with concrete phase corrections. Current64/859/2suites and both fresh v6 native receipts pass on the same eight runtime bytes. Only ownCancel prompt/card/keyboard/finish/dirty-write replay retires; original Ask/Decline/reconnect, Stop, Allow/Large commits/current subjects/history/order remain. Native fixture branch/OID/session are not installed authority; compositional native bridges remain independent. Historical transfer now uses USER-authorized strictly passive forwarding through the two existing receipt wrappers, actual historical/source/complete-work rows, eight producer controls and four held-JSON handled-finally/closure controls. Current67/890/2suites, final4/130 protocol and both fresh v7 native receipts qualify version replay and synthetic historical-409 route/remount retirement, retaining original cold native immutable identity/body/Download/Raw/inert/collapse/HEAD/current-file boundaries. Outcome support is deliberately minimal, NOT Allow execution credit. Strict queue-rejects-E probe was false and remains uncredited: actual original JSON rejects SAME E while the handled worker/finally fulfills after public Abort A. Final pagination-only transfer uses the actual 46-entry Card/picker, both new/modified original content rows, original selected-entry continuation and one actual page-boundary producer fault. Only Next-files/page-40 replay retires; native cold 46-entry review and both real 45-file commits stay. Allow's two reloads stay as the unique persisted default-UI/native-ID bridge. Unexecuted Native45/Allow expansion proposals are NOT required or credited: their native authority was not transferred. `R/resumed-implementation/git-own-cancel-{controls-qualified,browser-binding,browser-result}.json` and `git-historical-browser-result.json`. No new SDK/platform/policy or blanket KEEP; only those two passive forwards were authorized. |
| B7 | Finite Toolbar/New transfers and final coherent acceptance qualified | Toolbar checkpoint above plus adopted four-way actual navigation/Sidebar/chat binding and a SINGLE same-realm real default ChatWindow public eager-persistence→ensure→hook-created row→real navigation→ChatInput receiver. Five actual producer primitives qualify; initial unadmitted-stream control was stopped/retained/uncredited and oracle repaired before a complete 8/1 semantic RED. Current63/833/2suites GREEN and all3 native receipts GREEN on the same pinned source qualify ONLY duplicate mobile Starred→New ceremony retirement. First original Activity→New native source/destination/returned ID/empty context/non-inert input/backdrop/source restoration and all3 held initial-URL receivers remain. Full helper preserves both ceremonies; no fake created row, source-chat lower mount, input-triggered creation, Version-continuation/global-idle/native-IO-failure or NET claim. `R/resumed-implementation/activity-restore-{controls-qualified,browser-binding,browser-result}.json`. |
| B8 | Final whole correctness passed; performance remains informational | Final fresh all4/4 **386s recorded wall**, **509 files/4171 tests/14 suites**, all26 browser/terminal groups and genuine deployment VM pass on source `s7i5y24h0llqrqmxjhlxkk7r20flysgc-source`. Core lifecycle378.804s,1.701s before/.302s after. Browser234.292s includes3.634s support+4.843s definitions; VM74.681s includes17.426s guest evidence. Overlapping intervals are not additive. Earlier398.058s and failed matched421.959→430.232s remain historical evidence; no new matched NET or Panel claim. User made performance informational and deferred optimization. |

New findings must bind to a blocker or identify the specific original obligation
that requires changing this list. Speculative universal idle/escaped-work theorems
are not extra backlog. The unexplained earlier exporter refusal remains a retained
failure; if reproduced, diagnose exact identity changes without relaxing guards.

## Plan

**Current execution:** browser retirement and full correctness complete; only
proportional status review and final feature commits remain. One repository writer
coordinated every export/check budget. Qualified Thinking/Tool Second (including Sixth, excluding Navigation
Fourth and experimental LM retirement) was reconciled through 343 guarded source
file deltas, including the two explicitly mapped extracted-callback retirements.
Current instructions/guides were not replaced. The common-only Files remedy and
terminal-versus-observer/Navigation leaf/HOST-restoration repair have receiving
normal/regression/restoration evidence and independent source review. The first
receiving run exposed an incorrect newline oracle and a missing body-gate access
that stalled cleanup; exact-byte expectation and synchronous explicit-reason release
fix these fixture mismatches without production/input/deadline changes. Failed
and interrupted diagnostics remain retained, not meaningful producer reds.
`R/resumed-implementation/composition.json` binds adoption. The early whole4/4
checkpoint now supplies current complete correctness and wider receiving impact,
not completion or NET success. All1569 exported files matched the physical checkout
before status-only follow-up edits. Source commit `c694c014` retains those tested
application/test bytes at that checkpoint. Subsequent finite WP2 slices have their
own input-bound receiving/protocol/native/control evidence in the rows above; do
not relabel the earlier full run as execution of these later bodies.

**Whole-feedback checkpoint and stop:** command398.058438374s. Core391.542s includes
2.513s before the388.662s file window and0.367s afterward. Browser320.743s includes
89.312874s support/application realization and4.593235s definition preparation;
its group-client window is226.832s, summed client work824.912826s and summed capsule
work809.596038s (overlapping work, not additive elapsed savings). Genuine service
70.358s includes18.712s evidence execution; the remainder is mixed realization/
driver overhead, not all test execution. Core/browser intervals overlap. This
partly preparing run is not compared as a warm matched speedup. Full command is
47.008438s above ceiling; core test-file execution alone is37.612s above it.

The longest observed core files are reconciliation-mounted97.107s, rpc-manager
95.778s and Git cleanup75.418s; these are observations, not permission to reopen
RPC/cache work. **The user selected finishing WP2 browser retirement first.**
B3–B7 proceed serially, beginning with the coupled Reading/Thinking/Tool/version/
navigation slice. Do not repeat unchanged full timing; no performance waiver or
core tangent is implied.
Use independent review for changed risk, not an automatic second packet pipeline.

- [x] **WP1 — consolidate and repair shared foundations (B1/B2 receiving slice).** Build one
  receiving candidate from qualified compositions, sparsely reconciling dirty work;
  do not overwrite with old whole postimages or admit the experimental LM cut as
  qualified. Fix the two concrete lifetime residues. Acceptance: exact receiving
  diff/map, original held-Save schedules, actual capability restoration and known
  affected owners pass; meaningful controls cover changed boundaries. **Stop** for
  semantic conflict, lost inputs or a needed new product-policy decision.
- [x] **WP2 — bounded browser retirement implemented (B3–B7); full execution qualification is WP3.** Work serially through the
  coupled Reading/Thinking/Tool/version/navigation slice, then caller-preserving
  Files, Git and Activity gaps, reusing delivered source/maps/reviews. Pair each
  lower-owner change with its actual browser deletion; record removed setup,
  transactions and waits plus retained unique failures. Atomically update fresh
  IDs/dispatch/scenarios/independent validators and pre-callback retired/private-ID
  negatives. Acceptance per slice: affected normal, meaningful defect, required
  exceptional schedules, receiving-impact check and exact installed bridge.
  **Stop** on a gate failure to diagnose it; do not expand investigations or repeat
  unchanged runs. Additional controls need a named uncovered changed contract.
  - [x] **H-THINK finite cut:** qualify original-work failure schedules, restore
    normal13, then actually remove two Thinking GET/body/waits per original input
    and the request listener. Freshv4 IDs, independent guards and both retired-ID
    negatives pass; installed LD/LM histories pass. Tool/clipboard/composer/version/
    navigation fragments remain separate. Evidence: `R/resumed-implementation/thinking-browser-result.json`.
  - [x] **H-TOOL finite cut:** qualify the held-Copy/primary/unmount conjunction
    on the existing actual-default owner and retire duplicate value/refusal/probe
    setup. Current145 normal/protocol and both freshv5 installed profiles pass;
    native Clipboard/geometry and actual dynamic write/edit caller remain. Evidence:
    `R/resumed-implementation/tool-browser-result.json`. No new fixture platform,
    native Tool execution, failed-native-unmount or failed-native-Restore claim.
  - [x] **Native composer (B4) finite cut:** exact delivered composite03 remedy,
    actual ordering repair, both strict original native after-success controls,
    normal/restored BOTH profiles and current122 protocol pass. Freshv6 IDs and
    private-mode pre-callback rejection are reconciled; native undo/selection/
    focus/keyboard/IME and P1 remain. `R/resumed-implementation/composer-browser-result.json`.
  - [x] **Web/version (B3) finite cut:** existing authored original JSON/P/E
    control reaches strict terminal and intended RED38s; same normal/current140
    pass40s. Exact qualified native port reused; only the two-line LD guard and
    fresh v7 metadata compose with current neighbors. Both installed inputs pass43s;
    LM main physical/PWA work remains, duplicate LM version ceremony is gone.
    `R/resumed-implementation/web-version-browser-result.json`.
  - [x] **Navigation (B5) finite cut:** current26 and3 real producer defects,
    same optional-port60/814 restoration, exact current149 plus both original
    native after-success controls and normal/restored receipts pass. Desktop's
    duplicate controlled context race leaves; real branch UI/context and actual
    saved-key caller remain. `R/resumed-implementation/navigation-browser-result.json`.
  - [x] **Smaller Files upload cut (B2):** eleven semantic actual producer faults,
    existing82/940 shared impact, five strict original-native v2 exceptional/real-
    closure controls, current144 normal and both v4 installed restorations qualify
    this finite cut. Original v1 diagnostics/late errors remain uncredited. Actual
    Changed/Search/native watchers and all six M16/P1 inputs remain; no normal
    harness policy changed. `R/resumed-implementation/files-upload-browser-result.json`.
  - [x] **Git exact desktop reader (finite B6 subset):** real Card/Pierre normal,
    actual retained-model/selected-file defects, strict controlled transport/loader/
    future-JSON P/E/C/reference cleanup, current126 and both fresh LD3/unchangedLM2
    native restorations qualify only ED live-reader replay removal. Cold native,
    mobile/history/policy/large incarnations remain. No unpaired native02/03 costs.
    `R/resumed-implementation/git-reader-browser-result.json`.
  - [x] **Git selected-policy cancellation (finite B6 subset):** exact native02
    and added phases in existing default RPC/Source owners preserve original
    inputs and close the previously missing receiving negative wire composition.
    Five actual defects, normal107/current234 and subsequent same-source both-v4
    native execution qualify B-P; no second unchanged native run is needed.
    Native02's actual signal is not claimed to traverse an installed SDK session.
    `R/resumed-implementation/git-policy-browser-result.json`.
  - [x] **Mobile live-reader cache/view replay (finite B6 subset):** original
    Allow1280 before/reconnect390 data row in the existing Card/Pierre owner,
    two390-specific meaningful defects AFTER desktop completion, restored current127
    and both fresh v5 native receipts qualify actual browser action/wait retirement.
    BOTH inline-mobile drawer selection/close ceremonies remain on the original
    native subject; no Large stand-in, shared-HEAD change or historical closure.
    `R/resumed-implementation/git-mobile-reader-browser-result.json`.
  - [x] **Historical reader/409 (finite B6):** USER allowed ONLY passive
    `onReadWork` forwarding through actual Decision/Outcome wrappers. Both original
    Decision source-policy rows, minimal Outcome ownership support, eight actual
    forward/source producer faults and four actual held JSON/late-body/closure
    controls qualify version replay and SECOND synthetic 409 route/remount removal
    at both inputs. Original native immutable UUID/method/200 snapshot/current-file
    conflict/render2500/complete Download+failure-null/Raw bytes+preference/readonly/
    FIRSTcollapse/unmount/decisions/HEAD/current-file invariance and writer restore
    remain. Full helper preserves its old matrix/Playwright adapter; lower claims
    no removed adapter/native-IO/backend-expiry/PEC/global idle authority.
    Strict probe's queue-rejects-SAME-E assertion was false/uncredited; actual
    JSON original rejects E while worker/finally fulfills after public Abort A.
    Missing-import normal1 and bookkeeping parser failures retained, no unchanged
    retries. Outcome's unpaired deep matrix was trimmed before final acceptance.
    Current67/890/2suites GREEN139s (32.545s pre/100.945s lifecycle/.121s after),
    first native120s includes80.591s realization/4.152s definitions/capsule31.998s.
    Only inherited inaccurate PASS caption then changed: final4/130 GREEN39s and
    both native v7 GREEN43s (3.353s support/4.158s definitions/capsule31.740s),
    exact seven current runtime bytes. NOT matched speedup/cold-warm comparison.
    `/tmp/pi-web-test-core.yu4ehT/run.json`, `/tmp/pi-web-test-core.RssC5e/run.json`,
    `/tmp/pi-web-test-browser.sKIAUH/run.json`; final pinned
    `/nix/store/vjwkx04q0vq676lz579g9xa33nvx7qzd-source`.
    `R/resumed-implementation/git-historical-browser-result.json`.
  - [x] **Own manual Cancel (finite B6):** actual inline public Card/real hook
    original response plus ordinary RPC cancelled:true→null while signal stays
    live, native selected-file/mode/builtin-Ask/session/full-origin/no-effect rows.
    Nine actual producer REDs, both controlled FETCH E/SAME hook-catch/full callback
    after real root unmount, current64/859/2suites GREEN142s and both fresh native
    v6 GREEN54s/capsule39.790s on SAME pinned8 bytes qualify two original replay
    removals. Wrong abort-default mutant22GREEN and first JSON/hook-catch oracle
    are retained/uncredited; source `sendAgentCommand` JSON fallback is unchanged.
    No new SDK/session/platform/production seam, error filter/deadline or native
    failed-IO/whole-DefaultWindow/PEC/global-idle/NET claim. Native Ask/Decline/
    reconnect/Stop/Allow/Large and cross-profile commit/tree/history order remain.
    Core: 35.674s pre-lifecycle, 101.457s lifecycle, .144s after runner; wall includes
    realization. Native: 4.342s support, 5.005s definitions, 39.790s capsule.
    `/tmp/pi-web-test-core.s8msoH/run.json`, `/tmp/pi-web-test-browser.VMr9zF/run.json`;
    pinned `/nix/store/hmhjjiqld4a52kijjvxrl7br3y4r3i1y-source`.
    `R/resumed-implementation/git-own-cancel-browser-result.json`.
  - [x] **Activity Toolbar (finite B7 subset):** actual family/badge helper plus
    original genuine native S family/current registry/full body/default Toolbar
    bridge, two helper faults and actual AppShell count-forwarding semantic fault
    qualify removal of eight synthetic transition/wake/poll lines. Current129 and
    all three native profiles pass after restoration. First private preflight import
    failure is retained/uncredited; no new SDK/request or full-queue closure claim.
    `R/resumed-implementation/activity-toolbar-browser-result.json`.
  - [x] **Activity New/restoration (finite B7):** four-way actual navigation plus
    one actual public eager-persistence/ensure/default Window/Input receiver,
    five producer faults and full current shared restoration qualify ONE original
    mobile Starred→New ceremony retirement. Source chat/geometry/durable empty
    context remain with original Activity→New and all3 initial-URL native bridges.
    Current63/833/2suites GREEN143s (38.150s pre-lifecycle, 99.233s lifecycle;
    command includes realization), then SAME pinned8 inputs/all3 native GREEN111s
    (3.932s support, 4.737s definitions, capsule97.503s). Original first public
    fault hung on an unadmitted success-dependent stream; exact owned Nix client
    stopped275s, diagnostics retained/unqualified, oracle fixed without deadlines
    or error clearing; second48s reached actual callback undefined≠saved ID,
    8pass/1RED/0cancelled/0uncertain. Full helper retains both ceremonies; P1/M16,
    S/P/X/Pause/Acceptance untouched. Focused timings are NOT matched NET.
    `R/resumed-implementation/activity-restore-browser-result.json`;
    `/tmp/pi-web-test-core.ItexJK/run.json`, `/tmp/pi-web-test-browser.1sfBM1/run.json`;
    pinned `/nix/store/sk7gkc2qgnbvvyyhh2m1qvgy1nld0ly1-source`.
  - [x] **Final bounded Git pagination:** one existing capability realm, actual
    public Card→review→picker→selected reader, both original 45-file content rows;
    page 0/40 and entry 0/1/40 only. The actual Next-files producer fault fails at
    the named page-40 admission primitive; no success-dependent hanging wait.
    Normal1 wrong English selector is unqualified/retained, normal2 and restored
    current7/145 pass. Source review admits ONLY removing Next-files click/wait
    at both inputs; final native execution is part of WP3. Both native cold46
    page/body/fullscreen/approval/45-file commits and cross-profile history remain.
    Allow reloads deliberately retain native persisted-default-UI/current-ID
    authority, not a blanket whole-journey KEEP. The unexecuted Allow expansion
    was removed exactly; no new SDK setup, backend45 migration or lifetime audit.
    `R/resumed-implementation/finish-large-pagination-control-{binding,result}.json`.
  - [x] **Concrete final-acceptance blocker repaired:** first full run failed in
    unchanged Move's selected-uncertain bridge after196s; core was peer-cancelled
    and deployment did not start. Trace showed two valid200 catalogue replies,
    not an HTTP error. A pending initial hydration can supersede the move-owned
    load and turn its undefined result into a false refresh warning. Six lines
    cancel that redundant timer before a real detail refresh; stale guards and
    actual error reporting stay unchanged. Deterministic production-incarnation
    regression reaches the named timer failure before the fix, then current3/13
    GREEN40s including genuine503 visibility; unchanged native Move inputs pass
    97s/capsule16.483s (includes new application realization). The first regression
    fixture accidentally held Strict replay startup, timed out, and is retained
    unqualified; exact owned Nix client was stopped. Existing mount strict option
    now forwards through the fixture; defaults remain true. No Native assertion,
    error filter, sleep, deadline or source policy weakened. Independent review
    admits this finite fix, not a unique historical timer-stack theorem.
    `/tmp/pi-web-test-browser.giaebD/run.json` (failed),
    `/tmp/pi-web-test-core.kSgWLu/run.json`,
    `/tmp/pi-web-test-browser.blOBaq/run.json` (focused repair).
- [x] **WP3 — final correctness and closure (B8).** Completed the fresh
  `nix run .#test -- all --workers 4 --jobs 4` on the reviewed frozen candidate:
  static/core/plugins, full browser/terminal inventory and genuine deployment VM.
  Record source, selection, command wall time, preparation and execution separately.
  Diagnose actual failures without unchanged retries or weaker assertions. No new
  migration scope. Performance/NET/Panel targets are informational by explicit
  user decision; their earlier failures remain visible, but do NOT reopen tuning
  or require a matched timing campaign. Finish with reviewed feature commits;
  no integration, publication or cleanup is authorized.

## Final acceptance

`R/finish-correctness-all-2.log` passes the final frozen candidate, source digest
`f59b90e6cca74fc87312f41c9ea456891998c122583caebb78d2015964906139` at
`/nix/store/s7i5y24h0llqrqmxjhlxkk7r20flysgc-source`:

- Core/static/plugins: `/tmp/pi-web-test-core.17IFHZ/run.json`, 509 files,
  4171 tests/14 suites, no cancellations/uncertain files; declared-input static
  evidence is retained separately from fresh effectful execution.
- All26 browser/terminal groups: `/tmp/pi-web-test-browser.V6qaaX/run.json`.
  Both final Git v8 receipts complete; all original Move inputs pass unchanged.
- Genuine Home Manager deployment: `/tmp/pwv-0CjZyF/run.json`, all five guest
  checks pass, original clients settle, service stops, port refuses connections.
- Requested/effective4-browser/4-core overlap; 32 CPUs/~28.2GiB available at
  admission. Command386s includes in-run preparation, not model/review time.
- `R/resumed-implementation/finish-acceptance-result.json` binds runtime bytes,
  intervals, retained first failure, finite remedy and artifact paths. Subsequent
  plan-checkbox/status changes are prose-only, not a relabelled new-tip execution.

## Completion Checklist

- [x] Original 68 and named added obligations have final reviewed owner/bridge/
  obsolete dispositions; no silent deferral or blanket whole-journey KEEP.
- [x] Duplicate browser execution/setup/transactions/waits are actually removed;
  every retained step/input has concrete incremental value and truthful fresh IDs.
- [x] B1–B7 are closed on one adopted, reviewable feature candidate, with original
  input/lifetime premises and complete failure/native ownership preserved.
- [x] B8 correctness passes on relevant current inputs; earlier failures and preparation costs
  remain visible. No focused result is relabelled full acceptance or NET success.
- [x] Guides/guards/classification/package inputs match the candidate. Only after
  whole-task completion and separate authorization: rebase onto current local main,
  reassess relevant inputs, exact-state unsigned non-FF integration approval and
  separate bounded cleanup. No remote authorization exists.

**Known gaps:** Original matched NET/ceiling miss and unmeasured Panel median
remain deferred performance work, explicitly not completion gates. Work remains
unintegrated; no remote publication, rebase, merge or cleanup was authorized.
