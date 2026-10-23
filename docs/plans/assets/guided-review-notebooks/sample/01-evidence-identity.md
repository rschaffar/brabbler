# 1. Evidence identity

> **Design specimen.** Read as ordinary Markdown today. Existing `pi-review`
> cards below reference actual immutable source; the proposed steps, question
> controls and finding/reply exchange are illustrative, not active or saved.
> [Notebook overview](index.md) · [Interaction draft](../design.md)

Chapter ID: `evidence-identity`. All source targets use the full revision shown in
each card. Choosing a new local branch tip must not replace that content.

## 1.1 What chooses the code we see?

Step ID: `material-identity` · Suggested effort: focused.

**Look at:** the activation sequence below. `head` comes from the local branch;
`block.oid` remains the authored material identity passed through the URL helper.

**Check for:** whether source loading preserves that distinction. The server's
independent root/reachability checks are not proven by this client excerpt alone.

**Why it matters:** replacing the authored commit with a current branch tip could
make an explanation describe different code without telling the reviewer.

### Primary evidence: activation and immutable source request

```pi-review
{
  "version": 1,
  "kind": "source",
  "id": "identity-activation",
  "title": "Capture read authority; retain the authored source identity",
  "priority": "focused",
  "cwd": "/home/robert/projects/3rdparty/pi-desk",
  "branch": "main",
  "oid": "76e5fe4d06cb18f0eb800210dc1aaa4ced36bb92",
  "path": "components/ReviewNotebookBlock.tsx",
  "start": 42,
  "end": 53
}
```

### A question to record — increment 2 specimen

Question ID: `identify-material` · Text · Optional.

> In this excerpt, what is `head` used for, and which value pins the content?

Proposed response controls: **Answer** with text and optional explanation, or an
explicit **Unsure / Not applicable / Skip** outcome. No response is saved here.
An optional Reveal explanation would label the answer as authored guidance, not
an automatically graded result. Navigation never depends on this response.

**Navigation:** Back is disabled at the first step · Next → 1.2. A separate
Return to document action opens the notebook overview. These are labels in this
draft, not a new deep-link contract.

## 1.2 Can an obsolete read still change the display?

Step ID: `obsolete-read` · Suggested effort: thorough.

**Look at:** Implementation and Immutable-source test as two evidence targets.
On desktop, Compare displays them together. On mobile, Evidence → Compare stacks
them without changing the step or losing this question.

**Check for:** abort cleanup and signal guards on success, failure and loading
state. Then distinguish that mechanism from what the supplied server test covers.

**Why it matters:** an immutable response can still be the wrong response for the
currently selected step. Content identity and navigation ownership are separate
review concerns.

### Evidence A: implementation

```pi-review
{
  "version": 1,
  "kind": "source",
  "id": "obsolete-read-implementation",
  "title": "Abort pending reads and guard asynchronous state updates",
  "priority": "thorough",
  "cwd": "/home/robert/projects/3rdparty/pi-desk",
  "branch": "main",
  "oid": "76e5fe4d06cb18f0eb800210dc1aaa4ced36bb92",
  "path": "components/ReviewNotebookBlock.tsx",
  "start": 42,
  "end": 64
}
```

### Evidence B: immutable-source test — source, not a pass receipt

```pi-review
{
  "version": 1,
  "kind": "source",
  "id": "obsolete-read-test",
  "title": "Test source checks immutable bytes and bounded coordinates",
  "priority": "focused",
  "cwd": "/home/robert/projects/3rdparty/pi-desk",
  "branch": "main",
  "oid": "76e5fe4d06cb18f0eb800210dc1aaa4ced36bb92",
  "path": "lib/review-source.test.mjs",
  "start": 20,
  "end": 40
}
```

This test source exercises immutable server reads, path/range refusals and stale
branch capture. It does not itself mount a browser component or prove response
ordering across guided steps. This statement is about this excerpt, not a claim
that no other lifecycle tests exist. No tests were run for this sample.

### Review judgment — increment 2 specimen

Question ID: `obsolete-read-judgment` · Single choice · **Required for Reviewed**.

> Does the evidence shown establish that an obsolete response cannot replace the
> current step's material?

Authored Answer choices:

- Supported by the evidence I inspected.
- I found a potential gap.
- The supplied evidence is insufficient for this claim.

Optional explanation: describe the decisive mechanism or missing evidence.
Alternative recorded outcomes: **Unsure / Not applicable / Skip**. These are
separate outcomes, not agreement choices or blank answers.

**Unanswered example:** Next is available. Mark Reviewed is unavailable with
“Record a response to this required question first.” In progress and Needs
attention remain available. A recorded Skip satisfies response presence but
remains visibly skipped; it does not endorse the implementation. No state is
actually recorded by this document.

### Anchored finding and agent reply — fictional interaction specimen

The following exchange is **synthetic**, not a confirmed defect, real user
finding, executed investigation or live agent message.

**Finding F-01 · Open · Reviewer-authored specimen**

- Anchor: step `obsolete-read`, target `obsolete-read-implementation`, source
  `components/ReviewNotebookBlock.tsx:61–63` at the full pinned revision above.
- Text: “I want explicit lifecycle evidence before treating abort guards as proof
  of the entire guided-navigation claim. Can we inspect or propose a regression
  with an obsolete response completing after a newer selection?”
- No severity is inferred. This is a request to investigate a concern, not an
  assertion that the existing implementation is broken.

**Batch preview B-01 · Not sent**

- Destination: the existing authoring session, to be explicitly selected/confirmed.
- Included: F-01's content/version, step explanation/version and exact evidence
  references. No unrelated session history or unselected feedback is included.
- Request: “Investigate F-01, respond by ID, and propose any useful changes. Do
  not implement fixes or execute tests without separate applicable authority.”
- Actions in the future UI: Cancel / Send selected batch. Merely selecting F-01
  or preparing this preview sends nothing.

**Agent reply R-01 · Illustrative reply to F-01, original material version**

> The shown signal checks and cleanup are relevant mechanisms. The supplied test
> excerpt checks server material identity, not mounted guided-navigation ordering.
> Proposed next evidence: a controlled delayed-response regression at the future
> guided-reader boundary. This reply contains no test execution or patch claim.

**Reviewer actions:** Resolve / Keep open; Reopen becomes available after an
explicit resolution. The agent reply does not close F-01, change a review state,
or update the guide. F-01 may remain open even if the step is marked Reviewed.

**Navigation:** Back → 1.1 · Next → 1.3. Show full context and Return to step 1.2
remain distinct actions; the existing cards do not yet implement that tour state.

## 1.3 Which comparison are we actually inspecting?

Step ID: `comparison-scope` · Suggested effort: focused.

**Look at:** file-diff loading and its displayed Before identity.

**Check for:** whether the current card is a first-parent commit comparison or
an explicit whole-feature comparison. Do not infer the latter from a file name.

**Why it matters:** a source excerpt may be unchanged in this commit even though
it changed earlier in a feature. A feature review needs explicit base/candidate
identities, not silent reuse of first-parent commit semantics.

```pi-review
{
  "version": 1,
  "kind": "source",
  "id": "comparison-first-parent",
  "title": "Current card loads a commit-local patch and first-parent label",
  "priority": "focused",
  "cwd": "/home/robert/projects/3rdparty/pi-desk",
  "branch": "main",
  "oid": "76e5fe4d06cb18f0eb800210dc1aaa4ced36bb92",
  "path": "components/ReviewNotebookBlock.tsx",
  "start": 54,
  "end": 59
}
```

Question ID: `comparison-labels` · Multiple choice · Optional, increment 2.

> Which identities should be visible before you rely on a displayed comparison?

- Repository and file path.
- Explicit base/candidate or a clearly labeled commit/first-parent pair.
- Whether the current view is Source, Diff, Before or After.

Optional explanation and distinct Unsure / Not applicable / Skip are available
in the proposed form. There is no grading or live form in this specimen.

Optional design prompt, `comparison-preference` · Text: “Would you normally
start a feature-review stop in source or cumulative diff, and why?” This records
a preference, not authority to edit code or a promise about the final schema.

**Cross-file navigation:** Next →
[2.1 What can we conclude?](02-evidence-limits.md). The future guide keeps its
outline, evidence ownership and recording context across this chapter change;
the ordinary Markdown link today simply opens the other document.
