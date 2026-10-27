# Agent-created ordinary sessions

Ordinary Brabbler coding sessions can use **`start_session`** when the user has requested starting another session. This is separate from `Agent` subagents and conversation forks: it creates a fresh ordinary session, sends one initial prompt, and returns its ID/link without waiting for its task to complete. The user can continue chatting with it normally. Stopping or closing the creator does not stop a child whose initial prompt was already accepted. No completion report is sent back to the creator.

## Permissions

**Settings → Plugins → Session Launch** exposes **Start a session: Deny / Ask / Allow**, default **Ask**, and a global enable switch (enabled by default). Resolution is built-in → global → destination project → creator session, with the session layer applicable only to the creator's own project. Linked Git worktrees share canonical common-Git-directory identity. Outside Git, a canonical existing directory is the project identity.

A foreign destination never borrows the creator project's or session's Allow. Spawned sessions, forks, clones and subagents do not inherit creator-specific overrides. Moving a session deactivates overrides bound to its former project. Reset buttons expose inherited values; saving settings does not start work. Agents have no permission-writing tool and must not change their own settings via shell/API access. **Allow skips the card, not the requirement for a user-requested launch.** That intent boundary is tool guidance, not natural-language enforcement or an OS sandbox.

The launch tool is loaded only into ordinary coding sessions, including already spawned sessions. Chat-only sessions and subagents cannot call it. An ordinary caller can explicitly propose a Chat-only child by supplying an empty tool array.

## Exact proposal and approval

The tool requires `prompt`; optional `cwd`, `provider` plus `modelId`, `thinkingLevel`, `modelSpeed`, `toolNames`, and provider-to-account-ID `accounts` propose explicit changes. Omitted fields copy the creator's current directory, model/account snapshot, thinking, speed and built-in tool selection. Tool selection uses the ordinary shell selector: `bash` resolves to PowerShell on Windows where configured. Normal discovered/trusted resources and extensions load as in a user-created session; conversation history is never copied.

The approval card shows the resolved directory, model, thinking, speed, built-in tools, account IDs (never credentials), and complete initial prompt. It offers:

- **Approve & start:** approve the exact displayed proposal once.
- **Request changes:** return the **Additional details** feedback without creating a session; the agent must propose a revised launch.
- **Reject / Cancel:** start nothing.

Additional details never silently change an approved prompt. Collapse retains the local feedback draft. Pending cards replay on reconnect; server restart does not recreate approvals. Saved decision and execution cards are read-only.

The first prompt is **literal**: slash commands, skill commands and prompt templates are not executed/expanded. Extension input interception or transformation is refused for that initial turn. Later user prompts retain ordinary Pi behavior. Destination identity and relevant permissions are rechecked through SDK preflight, after asynchronous hooks and before agent dispatch. The approved model/thinking/speed, account snapshot and built-in tools must still match. Missing accounts/models fail closed; there is no fallback to ambient credentials or another model, and inherited preferences do not rewrite global new-session defaults.

## Navigation and outcomes

A child keeps an ordinary top-level sidebar entry. The creator's durable operation receipt contains **Open started session**; the child header shows **Started by…** linking back. Links use stable session IDs, so project moves do not require rewriting parent-file paths. If a linked session was deleted, the old link remains historical metadata, not a restored session.

`brabbler:session-spawn` custom data stores the created session ID, creator ID and operation ID outside model context. The created-ID check prevents copied entries from falsely attributing a later fork/clone to the original creator. This marker does not create a subagent family, affect archiving/deletion, or copy conversation content. The session-list scanner and its saved index retain it across reload/restart.

Ask and Allow both persist execution stages before effects and at settlement. **Policy authorized** is distinct from **User approved**. Success means the initial prompt was accepted, not that the child's task succeeded. Failure after creation retains the new session file and reports its ID/link; no implicit deletion or rollback occurs. Until final admission, a fresh launch destination is exclusively owned: ordinary prompts, steering, follow-ups, shell work, compaction and configuration changes are refused, while status and extension UI responses remain available. Stop, destination shutdown/deletion/destruction, or any owned setup/admission failure immediately and permanently refuses and retires that live wrapper without awaiting SDK abort/idle. Extension shutdown gets a fixed 1000ms grace before public SDK disposal; disposal does not certify settlement of arbitrary extension JavaScript or child processes. Late callbacks cannot accept or replay the refused turn. Explicit reopen of the retained file waits for old public disposal to succeed before constructing resources for that same persisted SDK session ID, including through URL aliases or hot reload. Disposal failure blocks same-ID reuse for the server lifetime; independent IDs do not wait. After successful disposal the file may be explicitly reopened for a fresh ordinary prompt (unavailable accounts still fail closed), never automatically replayed. Receipt-write failure after acceptance reports that acceptance honestly. Unsettled historical stages have unknown outcomes and cannot be replayed as launch authority.

External filesystem writers and other server processes are not locked out by the destination checks. There is no historical backfill, restart-resumable pending launch, auto-result collection, or remote session launch.

## Verification

Sandboxed core acceptance includes permission/destination, feedback/link validation and scanner/index tests in `lib/session-launch.test.mjs`, `lib/plugin-card-details.test.mjs` and `lib/session-spawn.test.mjs`, plus real SDK/tool coverage in `plugins/session-launch/runtime.test.mjs`. Focused iteration from the Linux worktree root:

```sh
nix run .#test -- core --file lib/session-launch.test.mjs \
  --file lib/plugin-card-details.test.mjs --file lib/session-spawn.test.mjs \
  --file plugins/session-launch/runtime.test.mjs
nix run .#test -- e2e --group session-launch
```

These are focused selections, not complete acceptance. The installed-package browser group uses the real launch service and independent SDK wrappers with a deterministic faux provider, never a live credential or provider endpoint. Complete acceptance includes this group, all other browser/terminal groups, core/static/plugin checks and the genuine Home Manager deployment VM. No manual dependency preparation or development server is needed. See [Testing](testing.md) and [browser fixtures](../e2e/README.md).
