# Declarative Markdown review notebooks

## Decision

Ordinary Markdown may opt into a small versioned `pi-review` fenced-JSON contract
for revision-bound source stops and commit reviews. The explanation stays plain
Markdown. These are read-only references, not executable cells, plugins, tool
calls, test execution, completion receipts or operation approvals. Unknown/malformed
contracts remain escaped readable data with an inactive diagnostic.

Initial consumers are settled ordinary chat text and Markdown-file previews.
Other Markdown surfaces deliberately remain literal. No raw-HTML/sanitizer expansion,
custom URL scheme, MDX runtime or third-party parser is needed. Existing special
Mermaid fences and file/source links keep their independent behavior.

## Material identity and authority

The full commit ID is the material identity; branch names never select replacement
content. Each explicit activation captures a currently authorized local branch tip,
then applies existing Git Explorer physical-root, reachability and captured-tip
revalidation to immutable object reads. A later branch advance can still authorize
the same commit. A changed branch during a read fails closed. No current-checkout
fallback, arbitrary revision expression, network fetch or line rebasing is allowed.

A new bounded source-range operation may read unchanged regular text files in the
authorized tree: this intentionally differs from changed-file-only patch/context
operations. It shares the immutable object reader's limits and adds literal path,
positive in-file coordinates and a 400-line displayed range limit. Recognizing a
marker does not grant file roots, Git access, editing or directory browsing.

## Presentation and navigation

Initial rendering performs no notebook Git reads. Explicit expansion captures
read authority and reuses the immutable commit/diff readers. Collapse aborts browser
requests and unmounts readers; the first delivery reloads instead of persisting
source, context or review progression.

The independent Git Explorer may temporarily display an explicitly referenced
repository without changing the selected sidebar checkout, session cwd/URL or
file/terminal ownership. This extends its selected-checkout default with a labelled,
read-only reference view and explicit Return to workspace history. Shared command
generations are allocated when reveal starts, so newer reveals, close/return and
session/workspace transitions supersede late results. Graph/detail agree on the
captured branch/tip and exact commit. Older off-page commits get exact detail and
an honest load-older notice, not unbounded auto-pagination.

## Consequences and future boundaries

The authoring guide at [Review notebooks](../review-notebooks.md) owns the schema,
controls and current limits. The first delivery has no persistent data migration,
repository aliases, public URL deep links, immutable side-pane tabs, human review
state or computed coverage. Removing the renderer leaves ordinary readable fenced
JSON. Later state/evidence work must distinguish opened, reviewed, approved and
tested; neither a visited stop nor authored prose establishes any of the others.
