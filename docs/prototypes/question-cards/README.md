# Question card visual proposal

**Status: proposal only.** This standalone mockup does not change the application,
its tool schema, or the installed service. All example content is synthetic.

Open [index.html](index.html) directly in a browser. No server, dependencies,
external assets or network access are needed. The page includes light/dark and
larger-text previews. Question navigation loads another sample and resets inputs;
choices and text fields are local illustration only. Cancel, collapse, review and
submission are not implemented. Nothing is sent or saved.

## Screenshots

Captured from this standalone mockup in a real browser:

- [Desktop, dark theme](screenshots/desktop-dark.png)
- [Desktop, light theme](screenshots/desktop-light.png)
- [Second question with different specific context](screenshots/second-question.png)
- [Mobile, default expanded contexts](screenshots/mobile.png)

The body scrolls when both expanded contexts and answers do not fit; the footer
stays visible. The screenshots deliberately retain that existing card constraint.

## Recommended hierarchy

1. A compact **set title** describes the topic, not the individual decision.
2. **Background for all questions** appears once, above the question navigation.
3. **The actual question** is the strongest text inside the card.
4. **Context for this question** appears immediately beneath that question,
   explaining the relevant situation and tradeoffs.
5. Options follow, with recommendations explicitly labelled but never preselected.
   An alternative written answer and additive details remain separate.

Both contexts start expanded and remain collapsible. The shared context stays in
the same place when changing questions; only the question-specific context changes.
Empty contexts should be omitted, not replaced with empty headings. The sample
has three independent decisions to demonstrate these two context scopes.

## Typography

| Element | Proposed default |
| --- | --- |
| Actual question | 18px, semibold, 1.4 line height |
| Set title | 14px, semibold |
| Context body | 14px, normal weight |
| Option title | 14px, semibold |
| Option description | 13px, normal weight |
| Navigation, context labels, helper text | 12px |
| Status badges | 11px |

The existing question-set heading uses `text-sm`: 0.875rem with a 14px root
becomes 12.25px, smaller than 13px option titles and default 14px Markdown.
The proposal uses an explicit question style rather than relying on heading-tag
browser defaults or root-relative small-text utilities.

In the application, question, context and option text should share the chat font
size offset while keeping the question four pixels larger. Markdown inside cards
must not independently become larger than the question. Context Markdown headings
also need a subordinate card-scoped hierarchy, not unrestricted chat heading sizes.
The larger-text preview illustrates the intended size relationship, not the real
settings implementation. On mobile, text fields and the question selector use at
least 16px to avoid input zoom, without shrinking the question. Editable controls
use a stronger border mixed from existing theme colors for clearer boundaries.

## What stays unchanged

- Existing light/dark color tokens, eight-pixel card corners, bounded scrolling
  body (`min(760px, 65dvh)`) and always-reachable footer.
- Desktop question buttons and the mobile question selector.
- Optional per-question `context` and set-level `context` in the existing schema.
  No new context field or persistence mechanism is needed.
- Draft recovery, free navigation, review, cancellation, optional skip, expiry,
  answer validation and atomic submission contracts.

Apply the same question emphasis to legacy single-question cards in a later
implementation. Keep their existing context and answer contract; a single question
does not need a synthetic set title or navigation. This mockup illustrates only
question sets, not single-question cards or receipts.

## Implementation boundary and verification

After design approval, implement presentation in `QuestionSetDialog`,
`QuestionFields`, `AskUserDialog` and narrowly scoped CSS. Shared question fields
also have notebook callers; preserve those callers' restricted rendering and
selection behavior. Do not restyle unrelated blocking approval cards globally.
Update the owning question guide and interface messages when labels change.

Verify question/context/option computed sizes at normal and enlarged chat sizes,
light and dark themes, long Markdown and narrow screens. Confirm empty contexts,
no default selection, keyboard navigation, retained drafts and the fixed footer.
Use the repository's required acceptance matrix for the actual application change.
Screenshots of this mockup are design evidence only, not application acceptance.

Mockup checks completed: default 18/14/14/13px question/context/option/description
sizes; enlarged 22/18/18/17px sizes; mobile selector at 16px; no horizontal overflow
at 430px or at 320px with enlarged text; visible footer; independent context
collapse; question-specific context changes; initially empty selections; alternative
answer field separate from details. Automated WCAG 2 A/AA scans reported no
violations in desktop light and dark views. Inline script syntax and local links
were checked. These checks do not cover the live React components or persistence.
