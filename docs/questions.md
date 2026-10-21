# Browser questions and question sets

`ask_user` supports a single question or a small set of related independent decisions. A set uses one inline card and one submission; navigating, selecting, writing and reviewing never sends partial answers to the agent.

## Answering a set

- Use the labelled question buttons (desktop), question selector (mobile), or Back/Next to move freely. Required questions must have a main answer. Optional questions must be answered or explicitly skipped.
- Single choice, multiple choice and text questions can be mixed. Recommendations are labels, never defaults. An exclusive option such as None cannot be combined with another option; an empty selection is not an answer.
- **Write an alternative answer** replaces the main choice(s). **Additional details** is a separate field that adds to either choices or written text. It never replaces the main answer and cannot satisfy a required question by itself.
- Switching questions or collapsing the card retains choices, inactive alternative text and additional details. Skipping retains a local draft for revisiting, but submits only the skip marker.
- Review shows the complete answer set with Edit links. Submit answers is also available before Review when every question is valid. Enter/Control+Enter in a field and Escape do not submit or discard a set.
- Cancel asks for confirmation when there are drafts. Stop, timeout and cancellation never submit a partial set.
- A network failure or missing acknowledgement retains the card and offers retry after a 15-second acknowledgement deadline. The server accepts a pending request once, validating every answer together. A stale/duplicate request cannot overwrite a saved answer.
- A fatal server-side receipt persistence error ends the request and rejects the tool and HTTP acknowledgement rather than claiming success or retrying a potentially partly written session entry.
- Completed requests appear as collapsed, read-only receipts with the displayed questions, options and submitted answers. Historical controls never invoke tools.

## Draft privacy and recovery

Batch drafts use this browser tab's `sessionStorage`, scoped to the session ID, request ID and exact request payload. Reload in the same tab restores drafts only when the server replays that still-pending request. Drafts are not sent to the model or saved in the session transcript. If browser storage is unavailable, the card warns that recovery is unavailable and keeps its in-memory drafts.

Settlement events and confirmed submission clear the draft. Reconnecting also supplies an authoritative pending-request snapshot: drafts and forms for settled or lost requests are removed for that session. Orphaned drafts in sessions not revisited are pruned on later saves: at most 12 sets are retained, with a 24-hour age limit checked on load/save. Closing the browser tab normally ends its session storage (browser session-restoration behavior is browser-dependent). This is not a secret-input form; don't enter credentials. Submitted answers and details become session history/model input like ordinary chat.

No cross-device draft syncing or exact pending-request recovery after a server restart is provided. For deliberate restart preparation, Activity **Pause** saves the waiting card's contents and then cancels it. Main-session **Resume** sends that context in a new continuation message so the agent can ask again; it does not restore the old form, submit drafts or reuse approval authority. Storage recovery does not keep a server request alive or reset its deadline. Browser refresh returns to the first question with answers restored.

## Tool contract

Use either the legacy `question` plus optional `options`/flags, or `title` and `questions`. Mixing those modes is rejected. The legacy result remains `details.response`; optional comments now also accompany written answers. Comments default on unless explicitly disabled or overridden by `PI_ASK_USER_ALLOW_COMMENT`.

Example batch:

```json
{
  "title": "Implementation decisions",
  "context": "The current application runs locally. These decisions are independent.",
  "questions": [
    {
      "id": "scope",
      "shortLabel": "Scope",
      "question": "Which scope should the first version have?",
      "type": "single",
      "options": [
        { "id": "small", "title": "Minimal", "recommended": true },
        { "id": "full", "title": "Complete" }
      ]
    },
    {
      "id": "platforms",
      "shortLabel": "Platforms",
      "question": "Which platforms should be supported?",
      "type": "multiple",
      "options": [
        { "id": "desktop", "title": "Desktop" },
        { "id": "mobile", "title": "Mobile" },
        { "id": "none", "title": "Neither", "exclusive": true }
      ]
    },
    {
      "id": "constraints",
      "shortLabel": "Constraints",
      "question": "Any other constraints?",
      "type": "text",
      "required": false
    }
  ]
}
```

There are 1–6 questions (2–4 encouraged), up to 12 options per choice question, stable IDs matching `[a-zA-Z0-9_-]{1,64}`, and unique question IDs / per-question option IDs. `required` defaults true. Each question has a concise `shortLabel` and optional `context`. Text questions omit options. Alternative text and additional details are always available in a batch, not model-controlled switches. Each text answer and details field is limited to 20,000 characters.

`details.answers` is an ordered array keyed by question ID:

```json
[
  { "id": "scope", "kind": "freeform", "text": "A tailored release", "comment": "Keep it reversible" },
  { "id": "platforms", "kind": "selection", "selections": ["desktop", "mobile"], "comment": "Test both sizes" },
  { "id": "constraints", "kind": "skipped" }
]
```

Cancellation returns `answers: null, cancelled: true`; timeout/Stop outcomes remain available in receipts. Tool results include human-readable questions, selected labels, alternative text and additional details. Events redact answers unless the existing explicit `PI_ASK_USER_EMIT_FULL_EVENTS` opt-in is enabled.

Batch only independent decisions that make sense together. Ask dependent follow-ups after receiving the set; no conditional/hidden questions exist. This browser extension does not change the standalone Pi TUI package. Existing running wrappers must be reloaded to pick up a changed tool schema after deployment.

## Implementation and verification

- `lib/question-set.ts`: bounded parsing, ID-based normalization and summaries.
- `lib/question-set-drafts.ts`: best-effort same-tab recovery with bounded retention.
- `lib/ask-user-extension.ts`: tool schema and batching guidance.
- `lib/rpc-manager.ts`: `askUserBatch()` uses the existing pending-request lifecycle as `ask_user_batch`.
- `components/QuestionSetDialog.tsx` and `QuestionSetReview.tsx`: live navigation and read-only review/history.
- `lib/interaction-receipts.ts`: recognized batch snapshots; legacy receipts stay compatible.

Focused browser acceptance: `nix develop -c env E2E_ASK_USER_ONLY=1 npm run test:e2e`. Unit contracts are covered by `lib/question-set.test.mjs`, `lib/ask-user.test.mjs` and `lib/rpc-manager-extension-ui.test.mjs`; receipt and hook regressions remain part of the common suite. See [testing.md](testing.md) and [../e2e/README.md](../e2e/README.md).
