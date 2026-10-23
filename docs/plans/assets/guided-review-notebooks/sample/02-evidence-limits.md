# 2. Evidence limits

> **Design specimen**, not an active guided chapter.
> [Notebook overview](index.md) · [Previous chapter](01-evidence-identity.md)

Chapter ID: `evidence-limits`.

## 2.1 What can we conclude?

Step ID: `review-evidence-limits` · Suggested effort: brief.

**Look at:** the source identities and the test excerpt in chapter 1.

**Check for:** the difference between observing a mechanism, inspecting a test's
source, receiving an agent explanation, and having an actual execution result.

**Why it matters:** even a well-authored tour can overstate its evidence. A
reviewer needs a place to challenge the guide, not just the implementation.

Optional question, `evidence-limit-summary` · Text · Increment 2 specimen:

> What additional evidence would you request before relying on the navigation
> ordering claim?

Optional guide issue, `G-01` · **Synthetic and not saved**:

> “Keep test source visibly labeled as source; do not show a green ‘passed’ badge
> unless an actual execution artifact establishes a pass for the named candidate.”

In the future review tray, this is kind **Guide issue**, separate from F-01's
investigation request. The reviewer can select either, both or neither for a
batch. The agent must not quietly edit the notebook in response to selection.

**Navigation:** Back → step 1.3 in the previous chapter · Next → end of tour
(disabled). Chapter/step jumps remain available; finishing does not mark all
steps Reviewed or resolve open feedback.

**No execution evidence:** this documentation task ran no application test suite.
Checking a card's commit/path/range proves a source reference, not application
correctness, browser behavior or deployment acceptance.
